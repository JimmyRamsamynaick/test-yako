// commands/moderation/voice.js
const { SlashCommandBuilder, ChannelType, PermissionFlagsBits, MessageFlags } = require('discord.js');
const Guild = require('../../models/Guild');
const BotEmbeds = require('../../utils/embeds');
const LanguageManager = require('../../utils/languageManager');
const { ComponentsV3 } = require('../../utils/ComponentsV3');

// Rôles considérés comme "staff" (bypass d'utilisation de la commande même sans perms)
const STAFF_HINTS = ['staff', 'moderator', 'modérateur', 'modo'];

function hasStaffBypass(member) {
  try {
    return member.roles?.cache?.some(r => {
      const name = (r.name || '').toLowerCase();
      return STAFF_HINTS.some(h => name.includes(h));
    }) || false;
  } catch (_) {
    return false;
  }
}

function canUse(member) {
  return member.permissions.has(PermissionFlagsBits.MoveMembers) || hasStaffBypass(member);
}

async function respondSmart(interaction, payload, acknowledgedExternally = false) {
  try {
    if (acknowledgedExternally) {
      return await interaction.followUp(payload);
    }
    if (interaction.deferred) {
      const isComponentsV3 = Array.isArray(payload?.components) && payload.components[0]?.type === 17;
      const isEphemeral = payload?.flags === MessageFlags.Ephemeral || payload?.flags === 32768;
      if (isEphemeral || isComponentsV3) {
        return await interaction.followUp(payload);
      }
      return await interaction.editReply(payload);
    }
    if (interaction.replied) {
      return await interaction.followUp(payload);
    }
    return await interaction.reply(payload);
  } catch (e) {
    if (String(e?.message || '').includes('acknowledged')) {
      try { return await interaction.followUp(payload); } catch (_) {}
    }
    try { return await interaction.reply(payload); } catch (_) {}
    try { return await interaction.editReply(payload); } catch (_) {}
    try { return await interaction.channel?.send(payload); } catch (_) {}
  }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('voice')
    .setDescription((LanguageManager.get('fr', 'common.channel_types.voice')) || 'Modération vocale')
    // Ne pas définir defaultMemberPermissions pour permettre l’affichage même sans perms
    .addSubcommand(sub =>
      sub.setName('kick')
        .setDescription('Expulser un membre de son canal vocal')
        .addUserOption(opt =>
          opt.setName('user')
            .setDescription('Le membre à expulser (vocal)')
            .setRequired(true)
        )
        .addStringOption(opt =>
          opt.setName('reason')
            .setDescription('Raison')
            .setRequired(false)
        )
    )
    .addSubcommand(sub =>
      sub.setName('ban')
        .setDescription('Interdire l’accès vocal (deny Connect)')
        .addUserOption(opt =>
          opt.setName('user')
            .setDescription('Le membre à bannir du vocal')
            .setRequired(true)
        )
        // Retirer scope et channel: le ban est toujours serveur
        .addStringOption(opt =>
          opt.setName('reason')
            .setDescription('Raison')
            .setRequired(false)
        )
    )
    .addSubcommand(sub =>
      sub.setName('unban')
        .setDescription('Retirer l’interdiction d’accès vocal')
        .addUserOption(opt =>
          opt.setName('user')
            .setDescription('Le membre à débanni du vocal')
            .setRequired(true)
        )
        // Retirer scope et channel: l’unban est toujours serveur
        .addStringOption(opt =>
          opt.setName('reason')
            .setDescription('Raison')
            .setRequired(false)
        )
    ),

  async execute(interaction) {
    let acknowledgedExternally = false;
    try {
      await interaction.deferReply({ ephemeral: true });
    } catch (e) {
      if (String(e?.message || '').includes('acknowledged')) {
        acknowledgedExternally = true;
      }
    }

    // Langue
    const guildDoc = await Guild.findOne({ guildId: interaction.guild.id });
    const lang = guildDoc?.language || 'fr';

    const sub = interaction.options.getSubcommand();

    // Vérification d’usage (MoveMembers OU rôle staff)
    if (!canUse(interaction.member)) {
      const err = BotEmbeds.createNoPermissionEmbed(interaction.guild.id, lang);
      return respondSmart(interaction, err, acknowledgedExternally);
    }

    // Sous-commande: KICK
    if (sub === 'kick') {
      const target = interaction.options.getMember('user');
      const reason = interaction.options.getString('reason') || LanguageManager.get(lang, 'common.no_reason') || 'Aucune raison fournie';

      if (!target) {
        const payload = await ComponentsV3.errorEmbed(interaction.guild.id, 'commands.kick.error_not_found', {}, true, lang);
        return respondSmart(interaction, payload, acknowledgedExternally);
      }

      const voice = target.voice;
      if (!voice || !voice.channel) {
        const payload = await ComponentsV3.errorEmbed(
          interaction.guild.id,
          'errors.no_permission',
          {},
          true,
          lang
        );
        // Message explicite sans nouvelle clé de langue
        payload.components[0].components.unshift({ type: 10, content: '### ❌ L’utilisateur n’est pas en vocal.' });
        return respondSmart(interaction, payload, acknowledgedExternally);
      }

      // Permissions bot
      if (!interaction.guild.members.me.permissions.has(PermissionFlagsBits.MoveMembers)) {
        const payload = BotEmbeds.createBotNoPermissionEmbed(interaction.guild.id, lang);
        return respondSmart(interaction, payload, acknowledgedExternally);
      }

      try {
        // Préférer disconnect(), fallback setChannel(null)
        if (typeof voice.disconnect === 'function') {
          await voice.disconnect(reason);
        } else {
          await voice.setChannel(null, reason);
        }

        const successPayload = BotEmbeds.createGenericSuccessEmbed(
          `${interaction.user.toString()} a expulsé ${target.toString()} du vocal pour ${reason}`,
          interaction.guild.id
        );
        // Message public d’annonce (non-éphémère)
        try {
          await interaction.followUp({
            embeds: [{
              title: '✅ Expulsion vocale',
              description: `${interaction.user.toString()} a expulsé ${target.toString()} du vocal pour ${reason}`,
              color: 0x57F287
            }]
          });
        } catch (_) {}
        return respondSmart(interaction, successPayload, acknowledgedExternally);
      } catch (error) {
        const payload = await ComponentsV3.errorEmbed(interaction.guild.id, 'commands.kick.error', {}, true, lang);
        return respondSmart(interaction, payload, acknowledgedExternally);
      }
    }

    // Sous-commande: BAN
    if (sub === 'ban') {
      const target = interaction.options.getMember('user');
      // Force ban vocal à l’échelle serveur (toutes les vocals)
      let scope = 'server';
      let channel = null;
      const reason = interaction.options.getString('reason') || LanguageManager.get(lang, 'common.no_reason') || 'Aucune raison fournie';

      if (!target) {
        const payload = await ComponentsV3.errorEmbed(interaction.guild.id, 'commands.kick.error_not_found', {}, true, lang);
        return respondSmart(interaction, payload, acknowledgedExternally);
      }

      // Permissions bot pour modifier overwrites
      if (!interaction.guild.members.me.permissions.has(PermissionFlagsBits.ManageChannels)) {
        const payload = BotEmbeds.createBotNoPermissionEmbed(interaction.guild.id, lang);
        return respondSmart(interaction, payload, acknowledgedExternally);
      }

      // Si le membre est en vocal, tenter de le déconnecter immédiatement
      const tv = target.voice;
      if (tv?.channel) {
        try {
          if (typeof tv.disconnect === 'function') {
            await tv.disconnect(reason);
          } else {
            await tv.setChannel(null, reason);
          }
        } catch (_) {}
      }

      try {
        if (scope === 'server') {
          const targets = interaction.guild.channels.cache.filter(c => c.type === ChannelType.GuildVoice || c.type === ChannelType.GuildStageVoice);
          for (const [_, ch] of targets) {
            await ch.permissionOverwrites.edit(target.id, { Connect: false }, { reason });
          }
        } else {
          await channel?.permissionOverwrites.edit(target.id, { Connect: false }, { reason });
        }

        const successPayload = BotEmbeds.createGenericSuccessEmbed(
          `${interaction.user.toString()} a banni ${target.toString()} de toutes les vocals du serveur pour ${reason}`,
          interaction.guild.id
        );
        try {
          await interaction.followUp({
            embeds: [{
              title: '✅ Ban vocal serveur appliqué',
              description: `${interaction.user.toString()} a banni ${target.toString()} de toutes les vocals du serveur pour ${reason}`,
              color: 0x57F287
            }]
          });
        } catch (_) {}
        return respondSmart(interaction, successPayload, acknowledgedExternally);
      } catch (error) {
        const payload = await ComponentsV3.errorEmbed(interaction.guild.id, 'commands.lock.error', {}, true, lang);
        payload.components[0].components.unshift({ type: 10, content: '### ❌ Erreur lors de l’application du ban vocal serveur.' });
        return respondSmart(interaction, payload, acknowledgedExternally);
      }
    }

    // Sous-commande: UNBAN
    if (sub === 'unban') {
      const target = interaction.options.getMember('user');
      const reason = interaction.options.getString('reason') || LanguageManager.get(lang, 'common.no_reason') || 'Aucune raison fournie';

      if (!target) {
        const payload = await ComponentsV3.errorEmbed(interaction.guild.id, 'commands.kick.error_not_found', {}, true, lang);
        return respondSmart(interaction, payload, acknowledgedExternally);
      }

      if (!interaction.guild.members.me.permissions.has(PermissionFlagsBits.ManageChannels)) {
        const payload = BotEmbeds.createBotNoPermissionEmbed(interaction.guild.id, lang);
        return respondSmart(interaction, payload, acknowledgedExternally);
      }

      try {
        // Unban vocal à l’échelle serveur: retirer Connect deny sur tous les salons vocaux
        const targets = interaction.guild.channels.cache.filter(c => c.type === ChannelType.GuildVoice || c.type === ChannelType.GuildStageVoice);
        for (const [_, ch] of targets) {
          const ov = ch.permissionOverwrites.resolve(target.id);
          if (ov) {
            await ch.permissionOverwrites.edit(target.id, { Connect: null }, { reason });
          }
        }

        const successPayload = BotEmbeds.createGenericSuccessEmbed(
          `${interaction.user.toString()} a retiré le ban vocal de ${target.toString()} sur toutes les vocals du serveur pour ${reason}`,
          interaction.guild.id
        );
        try {
          await interaction.followUp({
            embeds: [{
              title: '✅ Unban vocal serveur appliqué',
              description: `${interaction.user.toString()} a retiré le ban vocal de ${target.toString()} sur toutes les vocals du serveur pour ${reason}`,
              color: 0x57F287
            }]
          });
        } catch (_) {}
        return respondSmart(interaction, successPayload, acknowledgedExternally);
      } catch (error) {
        const payload = await ComponentsV3.errorEmbed(interaction.guild.id, 'commands.unlock.error', {}, true, lang);
        payload.components[0].components.unshift({ type: 10, content: '### ❌ Erreur lors du retrait du ban vocal serveur.' });
        return respondSmart(interaction, payload, acknowledgedExternally);
      }
    }
  }
};
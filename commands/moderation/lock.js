// commands/moderation/lock.js
const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const Guild = require('../../models/Guild');
const BotEmbeds = require('../../utils/embeds');
const LanguageManager = require('../../utils/languageManager');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('lock')
        .setDescription(LanguageManager.get('fr', 'commands.lock.description') || 'Verrouiller un salon')
        .setDescriptionLocalizations({
            'en-US': LanguageManager.get('en', 'commands.lock.description') || 'Lock a channel'
        })
        .addChannelOption(option =>
            option.setName('channel')
                .setDescription(LanguageManager.get('fr', 'commands.lock.channel_option') || 'Le salon à verrouiller')
                .setDescriptionLocalizations({
                    'en-US': LanguageManager.get('en', 'commands.lock.channel_option') || 'The channel to lock'
                })
                // Ajout de GuildAnnouncement + GuildForum; threads gérés via interaction.channel
                .addChannelTypes(ChannelType.GuildText, ChannelType.GuildVoice, ChannelType.GuildAnnouncement, ChannelType.GuildStageVoice, ChannelType.GuildForum)
                .setRequired(false))
        .addStringOption(option =>
            option.setName('reason')
                .setDescription(LanguageManager.get('fr', 'commands.lock.reason_option') || 'Raison du verrouillage')
                .setDescriptionLocalizations({
                    'en-US': LanguageManager.get('en', 'commands.lock.reason_option') || 'Reason for the lock'
                })
                .setRequired(false))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
    
    async execute(interaction) {
        // Récupérer la langue du serveur
        const guildData = await Guild.findOne({ guildId: interaction.guild.id });
        const lang = guildData?.language || 'fr';

        const channel = interaction.options.getChannel('channel') || interaction.channel;
        const reason = interaction.options.getString('reason') || require('../../utils/languageManager').get(lang, 'common.no_reason');

        // Vérifier les permissions de l'utilisateur
        if (!interaction.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
            const noPermEmbed = BotEmbeds.createNoPermissionEmbed(interaction.guild.id, lang);
            return interaction.reply({
                ...noPermEmbed,
                ephemeral: true
            });
        }

        // Vérifier les permissions du bot
        if (!interaction.guild.members.me.permissions.has(PermissionFlagsBits.ManageChannels)) {
            const botNoPermEmbed = BotEmbeds.createBotNoPermissionEmbed(interaction.guild.id, lang);
            return interaction.reply({
                ...botNoPermEmbed,
                ephemeral: true
            });
        }

        // Détection rapide: salon déjà verrouillé
        const everyone = interaction.guild.roles.everyone;
        let alreadyLocked = false;
        if (typeof channel.isThread === 'function' && channel.isThread()) {
            const perms = channel.permissionsFor(everyone);
            const deniesOk = perms && !perms.has(PermissionFlagsBits.SendMessages) && !perms.has(PermissionFlagsBits.AddReactions);
            alreadyLocked = (channel.locked === true) || !!deniesOk;
        } else if (channel.type === ChannelType.GuildText || channel.type === ChannelType.GuildAnnouncement || channel.type === ChannelType.GuildForum) {
            const perms = channel.permissionsFor(everyone);
            alreadyLocked = !!(perms &&
                !perms.has(PermissionFlagsBits.SendMessages) &&
                !perms.has(PermissionFlagsBits.AddReactions) &&
                !perms.has(PermissionFlagsBits.CreatePublicThreads) &&
                !perms.has(PermissionFlagsBits.CreatePrivateThreads) &&
                !perms.has(PermissionFlagsBits.SendMessagesInThreads)
            );
        } else if (channel.type === ChannelType.GuildVoice || channel.type === ChannelType.GuildStageVoice) {
            const perms = channel.permissionsFor(everyone);
            const connectDenied = perms && !perms.has(PermissionFlagsBits.Connect);
            const speakDenied = channel.type === ChannelType.GuildStageVoice ? (perms && !perms.has(PermissionFlagsBits.Speak)) : true;
            alreadyLocked = !!(connectDenied && speakDenied);
        }

        if (alreadyLocked) {
            const title = lang === 'en' ? '🔒 Channel already locked' : '🔒 Salon déjà verrouillé';
            const content = lang === 'en'
                ? `${channel} is already locked.`
                : `${channel} est déjà verrouillé.`;
            const payload = {
                components: [{
                    type: 17,
                    components: [{
                        type: 10,
                        content: `## ${title}\n\n${content}`
                    }]
                }]
            };
            return interaction.reply(payload);
        }

        // Accuser réception avant opérations potentiellement longues
        await interaction.deferReply({ ephemeral: false });

        try {
            const everyone = interaction.guild.roles.everyone;

            // Threads: verrouiller proprement (bloque l'écriture non-modérateur)
            if (typeof channel.isThread === 'function' && channel.isThread()) {
                try { await channel.setLocked(true, reason || 'Lock thread'); } catch (_) {}
                // Renforcer avec denies explicites
                await channel.permissionOverwrites.edit(everyone, {
                    SendMessages: false,
                    AddReactions: false
                }, { reason });
                const memberOrRoleAllows = channel.permissionOverwrites.cache.filter(ow => (
                    ow.allow.has(PermissionFlagsBits.SendMessages) ||
                    ow.allow.has(PermissionFlagsBits.AddReactions)
                ));
                for (const ow of memberOrRoleAllows.values()) {
                    try {
                        await channel.permissionOverwrites.edit(ow.id, {
                            SendMessages: false,
                            AddReactions: false
                        }, { reason });
                    } catch (e) {
                        console.warn('Erreur deny overwrite (thread) pour lock:', ow.id, e?.message);
                    }
                }
            } else if (channel.type === ChannelType.GuildText || channel.type === ChannelType.GuildAnnouncement || channel.type === ChannelType.GuildForum) {
                await channel.permissionOverwrites.edit(everyone, {
                    SendMessages: false,
                    AddReactions: false,
                    CreatePublicThreads: false,
                    CreatePrivateThreads: false,
                    SendMessagesInThreads: false
                }, { reason });

                // Appliquer un deny aux rôles/membres qui ont explicitement Allow sur l'écriture/threads
                const textOverwrites = channel.permissionOverwrites.cache.filter(ow => (
                    ow.allow.has(PermissionFlagsBits.SendMessages) ||
                    ow.allow.has(PermissionFlagsBits.AddReactions) ||
                    ow.allow.has(PermissionFlagsBits.CreatePublicThreads) ||
                    ow.allow.has(PermissionFlagsBits.CreatePrivateThreads) ||
                    ow.allow.has(PermissionFlagsBits.SendMessagesInThreads)
                ));
                for (const ow of textOverwrites.values()) {
                    try {
                        await channel.permissionOverwrites.edit(ow.id, {
                            SendMessages: false,
                            AddReactions: false,
                            CreatePublicThreads: false,
                            CreatePrivateThreads: false,
                            SendMessagesInThreads: false
                        }, { reason });
                    } catch (e) {
                        console.warn('Erreur deny overwrite (text) pour lock:', ow.id, e?.message);
                    }
                }

                // Vérifier que l'écriture est bien bloquée pour @everyone
                const canStillSend = channel.permissionsFor(everyone)?.has(PermissionFlagsBits.SendMessages);
                if (canStillSend) {
                    await channel.permissionOverwrites.edit(everyone, { SendMessages: false }, { reason });
                }

                // Force deny pour tous les overwrites restants afin d'éviter toute ré-autorisation
                for (const ow of channel.permissionOverwrites.cache.values()) {
                    try {
                        await channel.permissionOverwrites.edit(ow.id, {
                            SendMessages: false,
                            AddReactions: false,
                            CreatePublicThreads: false,
                            CreatePrivateThreads: false,
                            SendMessagesInThreads: false
                        }, { reason });
                    } catch (e) {
                        console.warn('Erreur force deny overwrite (text) pour lock:', ow.id, e?.message);
                    }
                }

                // Post‑vérification sur un membre non‑admin pour garantir le verrouillage
                const sampleMember = interaction.guild.members.cache.find(m => !m.user.bot && !m.permissions.has(PermissionFlagsBits.Administrator));
                if (sampleMember) {
                    const memberCanSend = channel.permissionsFor(sampleMember)?.has(PermissionFlagsBits.SendMessages);
                    if (memberCanSend) {
                        try {
                            await channel.permissionOverwrites.edit(sampleMember.id, {
                                SendMessages: false,
                                AddReactions: false,
                                CreatePublicThreads: false,
                                CreatePrivateThreads: false,
                                SendMessagesInThreads: false
                            }, { reason });
                        } catch (e) {
                            console.warn('Erreur deny spécifique membre pour lock:', sampleMember.id, e?.message);
                        }
                    }
                }
            } else if (channel.type === ChannelType.GuildVoice || channel.type === ChannelType.GuildStageVoice) {
                const voiceDeny = channel.type === ChannelType.GuildStageVoice
                    ? { Connect: false, Speak: false }
                    : { Connect: false };
                await channel.permissionOverwrites.edit(everyone, voiceDeny, { reason });

                // Appliquer un deny aux rôles/membres qui ont explicitement Allow sur Connect/Speak
                const voiceOverwrites = channel.permissionOverwrites.cache.filter(ow => (
                    ow.allow.has(PermissionFlagsBits.Connect) ||
                    ow.allow.has(PermissionFlagsBits.Speak)
                ));
                for (const ow of voiceOverwrites.values()) {
                    try {
                        await channel.permissionOverwrites.edit(ow.id, voiceDeny, { reason });
                    } catch (e) {
                        console.warn('Erreur deny overwrite (voice) pour lock:', ow.id, e?.message);
                    }
                }
            }

            const successEmbed = BotEmbeds.createLockSuccessEmbed(
                channel,
                reason,
                interaction.guild.id,
                interaction.user,
                lang
            );
            
            await interaction.editReply(successEmbed);

            // Envoyer dans les logs si configuré
            if (guildData && guildData.logs.enabled && guildData.logs.types.channels) {
                let logChannel = null;
                if (guildData.logs.channels && guildData.logs.channels.length > 0) {
                    const channelLogChannel = guildData.logs.channels.find(ch => ch.types.channels);
                    if (channelLogChannel) {
                        logChannel = interaction.guild.channels.cache.get(channelLogChannel.channelId);
                    }
                } else if (guildData.logs.channelId) {
                    logChannel = interaction.guild.channels.cache.get(guildData.logs.channelId);
                }

                if (logChannel) {
                    const { EmbedBuilder } = require('discord.js');
                    const logEmbed = new EmbedBuilder()
                        .setTitle('🔒 Salon verrouillé')
                        .setColor(0xFF6B00)
                        .addFields(
                            { name: '📁 Salon', value: `${channel} (${channel.name})`, inline: true },
                            { name: '👮 Modérateur', value: `${interaction.user} (${interaction.user.tag})`, inline: true },
                            { name: '📝 Raison', value: reason, inline: false }
                        )
                        .setTimestamp()
                        .setFooter({ text: `ID du salon: ${channel.id}` });

                    try {
                        await logChannel.send({ embeds: [logEmbed] });
                    } catch (logError) {
                        console.error('Erreur lors de l\'envoi du log de verrouillage:', logError);
                    }
                }
            }

        } catch (error) {
            console.error(error);
            const errorEmbed = BotEmbeds.createGenericErrorEmbed(
                'Une erreur est survenue lors du verrouillage du salon',
                interaction.guild.id,
                lang
            );
            if (interaction.deferred || interaction.replied) {
                try { await interaction.editReply(errorEmbed); } catch (_) {}
            } else {
                try { await interaction.reply(errorEmbed); } catch (_) {}
            }
        }
    }
};
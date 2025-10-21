// deploy-commands.js (clean)
require('dotenv').config();
const { REST, Routes } = require('discord.js');
const fs = require('node:fs');
const path = require('node:path');

// --- Config ---
const CLIENT_ID = process.env.CLIENT_ID;
const TOKEN = process.env.DISCORD_TOKEN;
const ENV_GUILD_IDS = (process.env.GUILD_IDS || '')
  .split(',')
  .map(id => id.trim())
  .filter(Boolean);

// --- CLI parsing ---
const argv = process.argv.slice(2);
const getArg = (name) => {
  const pref = `--${name}`;
  const found = argv.find(a => a === pref || a.startsWith(`${pref}=`));
  if (!found) return null;
  const eq = found.indexOf('=');
  return eq === -1 ? true : found.slice(eq + 1);
};

const modeArg = getArg('mode'); // 'global' | 'guild'
const guildsArg = getArg('guilds'); // comma-separated ids
const clear = argv.includes('--clear');
const dry = argv.includes('--dry');

const MODE = modeArg === 'global' || modeArg === 'guild'
  ? modeArg
  : (ENV_GUILD_IDS.length > 0 ? 'guild' : 'global');
const GUILD_IDS = (typeof guildsArg === 'string' && guildsArg.length > 0)
  ? guildsArg.split(',').map(x => x.trim()).filter(Boolean)
  : ENV_GUILD_IDS;

// --- Validation ---
if (!CLIENT_ID || !TOKEN) {
  console.error('❌ Variables d\'environnement manquantes: CLIENT_ID et/ou DISCORD_TOKEN');
  console.error('   Astuce: créez un fichier .env avec CLIENT_ID et DISCORD_TOKEN');
  process.exit(1);
}
if (MODE === 'guild' && GUILD_IDS.length === 0) {
  console.error('❌ Mode guilde sélectionné mais aucune guilde fournie.');
  console.error('   Utilisez --guilds=<id1,id2> ou définissez GUILD_IDS dans .env');
  process.exit(1);
}

// --- Charge toutes les commandes du dossier commands ---
function loadCommands(dir) {
  const items = fs.readdirSync(dir);
  const out = [];
  for (const item of items) {
    const full = path.join(dir, item);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      out.push(...loadCommands(full));
    } else if (item.endsWith('.js')) {
      const mod = require(full);
      if (mod && mod.data && typeof mod.data.toJSON === 'function') {
        out.push(mod.data.toJSON());
        console.log(`✅ Commande chargée: ${mod.data.name}`);
      } else {
        console.log(`⚠️ Ignoré (structure invalide): ${full}`);
      }
    }
  }
  return out;
}

const commandsPath = path.join(__dirname, 'commands');
console.log('🧩 Chargement des commandes...');
const commands = loadCommands(commandsPath);
console.log(`📦 ${commands.length} commande(s) prête(s) à être déployée(s).`);

// --- REST client ---
const rest = new REST().setToken(TOKEN);

async function deployGlobal() {
  console.log('🚀 Mode: Global');
  if (clear) {
    console.log('🗑️ Nettoyage des commandes globales existantes...');
    if (!dry) {
      await rest.put(Routes.applicationCommands(CLIENT_ID), { body: [] });
    }
    console.log('✅ Nettoyage global terminé.');
  }
  console.log('⬆️ Déploiement des commandes globales...');
  if (!dry) {
    const data = await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
    console.log(`✅ ${data.length} commande(s) déployée(s) globalement.`);
    data.forEach(cmd => console.log(`   • /${cmd.name}`));
  } else {
    console.log('💡 DRY RUN: aucune requête envoyée.');
  }
  console.log('🎉 Terminé (global).');
}

async function deployGuilds() {
  console.log('🚀 Mode: Guildes');
  console.log(`🏷️ Guildes ciblées: ${GUILD_IDS.join(', ')}`);
  for (const guildId of GUILD_IDS) {
    try {
      if (clear) {
        console.log(`🗑️ Nettoyage des commandes pour ${guildId}...`);
        if (!dry) {
          await rest.put(Routes.applicationGuildCommands(CLIENT_ID, guildId), { body: [] });
        }
        console.log(`✅ Nettoyage terminé pour ${guildId}.`);
      }
      console.log(`⬆️ Déploiement des commandes pour ${guildId}...`);
      if (!dry) {
        const data = await rest.put(Routes.applicationGuildCommands(CLIENT_ID, guildId), { body: commands });
        console.log(`✅ ${data.length} commande(s) déployée(s) sur ${guildId}.`);
        data.forEach(cmd => console.log(`   • /${cmd.name}`));
      } else {
        console.log('💡 DRY RUN: aucune requête envoyée.');
      }
    } catch (err) {
      console.error(`❌ Erreur de déploiement pour ${guildId}:`, err);
    }
  }
  console.log('🎉 Terminé (guildes).');
}

(async () => {
  console.log(`⚙️ Lancement du déploiement (mode=${MODE}, clear=${clear}, dry=${dry})`);
  try {
    if (MODE === 'global') {
      await deployGlobal();
    } else {
      await deployGuilds();
    }
  } catch (error) {
    console.error('❌ Erreur lors du déploiement:', error);
    process.exitCode = 1;
  }
})();
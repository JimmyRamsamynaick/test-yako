const fs = require('fs');
const path = require('path');

const TRANSCRIPTS_DIR = path.join(__dirname, '..', 'transcripts');
const TTL_MS = 48 * 60 * 60 * 1000; // 48 hours

function ensureDir() {
    try {
        if (!fs.existsSync(TRANSCRIPTS_DIR)) {
            fs.mkdirSync(TRANSCRIPTS_DIR, { recursive: true });
        }
    } catch (e) {
        console.error('[Tickets] Failed to ensure transcripts directory:', e.message);
    }
}

function sanitizeFilename(name) {
    return name.replace(/[^a-zA-Z0-9-_]/g, '_').slice(0, 90);
}

function getTranscriptFilePath(channelName) {
    ensureDir();
    const filename = `${sanitizeFilename(channelName)}.txt`;
    return path.join(TRANSCRIPTS_DIR, filename);
}

function initTranscript(channel, categoryKey, openerUserTag) {
    try {
        const filePath = getTranscriptFilePath(channel.name);
        const header = `# Ticket Transcript\nChannel: ${channel.name}\nCategory: ${categoryKey}\nOpened by: ${openerUserTag}\nOpened at: ${new Date().toISOString()}\nGuild: ${channel.guild?.name || ''}\n----------------------------------------\n`;
        fs.appendFileSync(filePath, header, 'utf8');
    } catch (e) {
        console.error('[Tickets] Failed to init transcript:', e.message);
    }
}

function appendMessage(channel, message) {
    try {
        const filePath = getTranscriptFilePath(channel.name);
        const author = `${message.author?.tag || message.member?.user?.tag || 'Unknown'}`;
        const time = new Date(message.createdTimestamp || Date.now()).toISOString();
        const content = message.content || '';
        const attachments = message.attachments && message.attachments.size > 0
            ? ` Attachments: ${Array.from(message.attachments.values()).map(a => a.url).join(', ')}`
            : '';
        const line = `[${time}] ${author}: ${content}${attachments}\n`;
        fs.appendFile(filePath, line, (err) => {
            if (err) console.error('[Tickets] Failed to append transcript line:', err.message);
        });
    } catch (e) {
        console.error('[Tickets] Failed to append transcript:', e.message);
    }
}

function appendSystemLine(channel, content) {
    try {
        const filePath = getTranscriptFilePath(channel.name);
        const time = new Date().toISOString();
        const line = `[${time}] SYSTEM: ${content}\n`;
        fs.appendFile(filePath, line, (err) => {
            if (err) console.error('[Tickets] Failed to append system line:', err.message);
        });
    } catch (e) {
        console.error('[Tickets] Failed to append system line:', e.message);
    }
}

function cleanupOldTranscripts() {
    ensureDir();
    const now = Date.now();
    fs.readdir(TRANSCRIPTS_DIR, (err, files) => {
        if (err) {
            console.error('[Tickets] Failed to list transcripts for cleanup:', err.message);
            return;
        }
        files.forEach((file) => {
            const filePath = path.join(TRANSCRIPTS_DIR, file);
            fs.stat(filePath, (err, stats) => {
                if (err) return;
                const age = now - stats.mtimeMs;
                if (age > TTL_MS) {
                    fs.unlink(filePath, (err) => {
                        if (err) {
                            console.error('[Tickets] Failed to delete old transcript:', err.message);
                        } else {
                            console.log('[Tickets] Deleted old transcript:', file);
                        }
                    });
                }
            });
        });
    });
}

function scheduleCleanup() {
    // Run on startup and then hourly
    cleanupOldTranscripts();
    setInterval(() => cleanupOldTranscripts(), 60 * 60 * 1000);
}

module.exports = {
    TRANSCRIPTS_DIR,
    getTranscriptFilePath,
    initTranscript,
    appendMessage,
    appendSystemLine,
    scheduleCleanup
};
const { ChannelType } = require('discord.js');
const { appendMessage } = require('../utils/ticketTranscripts');

module.exports = {
    name: 'messageCreate',
    async execute(message) {
        try {
            if (!message.guild) return;
            if (message.author?.bot) return;

            // Only track messages in channels whose name starts with 'ticket-'
            const channel = message.channel;
            if (channel?.type !== ChannelType.GuildText) return;
            if (!channel?.name?.startsWith('ticket-')) return;

            appendMessage(channel, message);
        } catch (e) {
            console.error('[Tickets] messageCreate transcript append failed:', e.message);
        }
    }
};
// In-memory registry to track ticket metadata and closure info by channelId
const registry = new Map();

function setTicketMeta(channelId, meta) {
  if (!channelId || !meta) return;
  const prev = registry.get(channelId) || {};
  registry.set(channelId, { ...prev, ...meta });
}

function updateOnClose(channelId, data) {
  setTicketMeta(channelId, data);
}

function setClosedBy(channelId, user) {
  if (!channelId || !user) return;
  updateOnClose(channelId, {
    closedByUserId: user.id,
    closedByTag: user.tag,
    closedByUsername: user.username,
    closedAt: Date.now(),
  });
}

function consumeClosedBy(channelId) {
  const info = registry.get(channelId);
  if (!info || !info.closedByUserId) return null;
  return { userId: info.closedByUserId, tag: info.closedByTag };
}

function consumeAll(channelId) {
  const info = registry.get(channelId) || null;
  if (info) registry.delete(channelId);
  return info;
}

module.exports = { setTicketMeta, updateOnClose, setClosedBy, consumeClosedBy, consumeAll };
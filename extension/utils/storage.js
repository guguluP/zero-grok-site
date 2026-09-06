// Storage helpers - see full file
export async function getByProvider() { return (await chrome.storage.local.get('byProvider')).byProvider || {}; }
export async function setProviderUsage(provider, data) {
  const all = await getByProvider();
  all[provider] = { ...all[provider], ...data, updatedAt: Date.now() };
  await chrome.storage.local.set({ byProvider: all });
  return all;
}

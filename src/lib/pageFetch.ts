// 在已打开的站点标签页里发起 fetch，Origin / Cookie 与页面一致，避免扩展 SW 鉴权失败。

export interface PageFetchResult {
  ok: boolean;
  status: number;
  text: string;
}

function hostPatterns(origins: string[]): string[] {
  return origins.flatMap((origin) => {
    const host = origin.replace(/^https?:\/\//, '').replace(/\/$/, '');
    return [`*://${host}/*`];
  });
}

/** 在指定站点标签页执行 fetch；没有可用标签时返回 null。 */
export async function fetchInPageContext(
  preferredOrigins: string[],
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: string } = {}
): Promise<PageFetchResult | null> {
  const tabs = await chrome.tabs.query({ url: hostPatterns(preferredOrigins) });
  const tab = tabs.find((t) => typeof t.id === 'number');
  if (tab?.id == null) return null;

  const method = init.method || 'GET';
  const headers = init.headers || {};
  // executeScript args 必须可结构化克隆，不能传 undefined
  const body = init.body ?? '';

  const injected = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    world: 'ISOLATED',
    func: async (
      fetchUrl: string,
      fetchMethod: string,
      fetchHeaders: Record<string, string>,
      fetchBody: string
    ) => {
      try {
        const res = await fetch(fetchUrl, {
          method: fetchMethod,
          headers: fetchHeaders,
          ...(fetchBody ? { body: fetchBody } : {}),
          credentials: 'include',
        });
        return { ok: res.ok, status: res.status, text: await res.text() };
      } catch (e) {
        return {
          ok: false,
          status: 0,
          text: e instanceof Error ? e.message : String(e),
        };
      }
    },
    args: [url, method, headers, body],
  });

  return (injected[0]?.result as PageFetchResult | undefined) ?? null;
}

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

function workspaceIdFromPathname(pathname) {
  const match = pathname.match(/^\/app\/([^/]+)/);
  return match ? match[1] : null;
}

function isFocusedWorkspaceClientForRoute(client, route) {
  if (!client.focused) {
    return false;
  }

  try {
    const clientWorkspaceId = workspaceIdFromPathname(new URL(client.url).pathname);
    const routeWorkspaceId = workspaceIdFromPathname(new URL(route, self.location.origin).pathname);
    return clientWorkspaceId !== null && clientWorkspaceId === routeWorkspaceId;
  } catch {
    return false;
  }
}

self.addEventListener("push", (event) => {
  let payload = {};
  if (event.data) {
    try {
      payload = event.data.json();
    } catch {
      payload = { title: "Task update", body: event.data.text() };
    }
  }

  const title = payload.title || "Task update";
  const options = {
    body: payload.body || "",
    icon: "/favicon-192x192.png",
    badge: "/favicon-192x192.png",
    tag: payload.tag || `meowbert-task-${payload.taskId || Date.now()}`,
    data: {
      route: payload.route || "/app",
      taskId: payload.taskId
    }
  };

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      if (clients.some((client) => isFocusedWorkspaceClientForRoute(client, options.data.route))) {
        return;
      }
      return self.registration.showNotification(title, options);
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const route = event.notification.data?.route || "/app";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ("focus" in client) {
          if (route && client.url.includes(route)) {
            return client.focus();
          }
          if ("navigate" in client) {
            return client.navigate(route).then(() => client.focus());
          }
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(route);
      }
    })
  );
});

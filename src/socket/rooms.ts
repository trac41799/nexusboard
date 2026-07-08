export function workspaceRoom(workspaceId: string): string {
  return `workspace:${workspaceId}`;
}

export function channelRoom(channelId: string): string {
  return `channel:${channelId}`;
}

export function userRoom(userId: string): string {
  return `user:${userId}`;
}

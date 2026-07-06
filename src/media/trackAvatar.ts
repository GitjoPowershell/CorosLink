const TRACK_AVATAR_COLORS = [
  "#2d9a74",
  "#6366f1",
  "#d89b22",
  "#ec4899",
  "#14b8a6",
  "#f97316",
];

export function trackAvatarColor(title: string): string {
  let hash = 0;

  for (const character of title) {
    hash = (hash + character.charCodeAt(0)) % TRACK_AVATAR_COLORS.length;
  }

  return TRACK_AVATAR_COLORS[hash];
}

export function trackInitial(title: string): string {
  const trimmed = title.trim();
  return trimmed ? trimmed[0].toUpperCase() : "?";
}

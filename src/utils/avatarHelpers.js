/**
 * Generate user avatar initials from name
 */
export function getInitials(name) {
  if (!name || typeof name !== 'string') return 'U';
  return name
    .split(' ')
    .slice(0, 2)
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

/**
 * Generate deterministic color from initials
 */
export function getAvatarColor(initials) {
  const colors = [
    '#1D9E75', // Peerlytics green
    '#4facfe', // Blue
    '#e74c3c', // Red
    '#f39c12', // Orange
    '#9b59b6', // Purple
    '#3498db', // Sky blue
    '#2ecc71', // Light green
    '#e67e22', // Dark orange
  ];
  const hash = initials
    .split('')
    .reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return colors[hash % colors.length];
}

export const EXPENSE_CATEGORIES = {
  food: {
    label: '食',
    emoji: '🍱',
    icon: 'fa-utensils',
    color: 'text-orange-500',
    bg: 'bg-orange-50 dark:bg-orange-950/30',
    barColor: 'bg-orange-400',
  },
  grocery: {
    label: '雜貨',
    emoji: '🛒',
    icon: 'fa-cart-shopping',
    color: 'text-green-500',
    bg: 'bg-green-50 dark:bg-green-950/30',
    barColor: 'bg-green-400',
  },
  transport: {
    label: '交通',
    emoji: '🚇',
    icon: 'fa-car',
    color: 'text-blue-500',
    bg: 'bg-blue-50 dark:bg-blue-950/30',
    barColor: 'bg-blue-400',
  },
  telecom: {
    label: '通訊',
    emoji: '📱',
    icon: 'fa-mobile-screen',
    color: 'text-purple-500',
    bg: 'bg-purple-50 dark:bg-purple-950/30',
    barColor: 'bg-purple-400',
  },
  health: {
    label: '醫療',
    emoji: '💊',
    icon: 'fa-heart-pulse',
    color: 'text-red-500',
    bg: 'bg-red-50 dark:bg-red-950/30',
    barColor: 'bg-red-400',
  },
  shopping: {
    label: '購物',
    emoji: '🛍',
    icon: 'fa-bag-shopping',
    color: 'text-pink-500',
    bg: 'bg-pink-50 dark:bg-pink-950/30',
    barColor: 'bg-pink-400',
  },
  bills: {
    label: '賬單',
    emoji: '🧾',
    icon: 'fa-file-invoice',
    color: 'text-amber-600',
    bg: 'bg-amber-50 dark:bg-amber-950/30',
    barColor: 'bg-amber-400',
  },
  entertainment: {
    label: '娛樂',
    emoji: '🎬',
    icon: 'fa-film',
    color: 'text-indigo-500',
    bg: 'bg-indigo-50 dark:bg-indigo-950/30',
    barColor: 'bg-indigo-400',
  },
  other: {
    label: '其他',
    emoji: '🏷',
    icon: 'fa-receipt',
    color: 'text-gray-500',
    bg: 'bg-gray-50 dark:bg-gray-900/30',
    barColor: 'bg-gray-400',
  },
};

export function getCategoryInfo(category) {
  return EXPENSE_CATEGORIES[category] || EXPENSE_CATEGORIES.other;
}

export function formatCategoryForLine(category) {
  const info = getCategoryInfo(category);
  return `${info.emoji} ${info.label}`;
}

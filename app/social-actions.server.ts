export const SOCIAL_ACTIONS = [
  { action: "INSTAGRAM_FOLLOW", label: "Suivre sur Instagram", points: 50, requiresHandle: true },
  { action: "TIKTOK_FOLLOW", label: "Suivre sur TikTok", points: 50, requiresHandle: true },
  { action: "FACEBOOK_FOLLOW", label: "Suivre sur Facebook", points: 50, requiresHandle: true },
  { action: "NEWSLETTER", label: "Je suis déjà abonné(e) à la newsletter", points: 100, requiresHandle: false },
] as const;

export type SocialActionKey = (typeof SOCIAL_ACTIONS)[number]["action"];

export function getSocialAction(action: string) {
  return SOCIAL_ACTIONS.find((a) => a.action === action);
}

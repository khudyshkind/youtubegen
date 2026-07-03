// Referral bonus amounts — keep in sync with DB trigger handle_referral_on_plan_upgrade
// Change both here and in the trigger when adjusting bonuses
export const REFERRER_BONUS = 15000  // credits paid to referrer on referred user's first paid plan
export const REFEREE_BONUS  = 3000   // credits given to new user on signup (bypasses PLAN_MAX_CREDITS cap)

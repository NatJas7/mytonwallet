import type { LangCode } from '../types';

import { HELP_CENTER_URL } from '../../config';

export function getHelpCenterUrl(langCode: LangCode | undefined, type: keyof typeof HELP_CENTER_URL): string {
  if (!langCode) return '';

  return (HELP_CENTER_URL[type] as Partial<Record<LangCode, string>>)?.[langCode] ?? HELP_CENTER_URL[type].en;
}

import type { ComponentType } from 'react';
import type { HumanStepRendererProps } from '@shared/renderer';

import CodingConfirmSpec from '../../flows/coding/frame/confirm-spec/renderer';
import CodingConfirmVerify from '../../flows/coding/verify/confirm-verify/renderer';

export type HumanStepRenderer = ComponentType<HumanStepRendererProps>;

export const rendererRegistry: Record<string, HumanStepRenderer> = {
  'coding:confirm-spec': CodingConfirmSpec,
  'coding:confirm-verify': CodingConfirmVerify,
};

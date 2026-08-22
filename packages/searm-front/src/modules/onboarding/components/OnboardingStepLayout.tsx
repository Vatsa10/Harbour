import { onboardingConfigState } from '@/client-config/states/onboardingConfigState';
import { OnboardingLayout } from '@/onboarding/components/OnboardingLayout';
import { OnboardingTransitionOutlet } from '@/onboarding/components/OnboardingTransitionOutlet';
import { useOnboardingFreeCreditsTotal } from '@/onboarding/hooks/useOnboardingFreeCreditsTotal';
import { useAtomStateValue } from '@/ui/utilities/state/jotai/hooks/useAtomStateValue';
import { isDefined } from 'searm-shared/utils';

export const OnboardingStepLayout = () => {
  const onboardingConfig = useAtomStateValue(onboardingConfigState);
  const freeCreditsTotal = useOnboardingFreeCreditsTotal();

  return (
    <OnboardingLayout
      freeCredits={isDefined(onboardingConfig) ? freeCreditsTotal : undefined}
    >
      <OnboardingTransitionOutlet />
    </OnboardingLayout>
  );
};

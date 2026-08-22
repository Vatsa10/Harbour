import { ONBOARDING_PATHS } from '@/auth/constants/OnboardingPaths';
import { ONGOING_USER_CREATION_PATHS } from '@/auth/constants/OngoingUserCreationPaths';
import { useIsLogged } from '@/auth/hooks/useIsLogged';
import { currentWorkspaceState } from '@/auth/states/currentWorkspaceState';
import { returnToPathState } from '@/auth/states/returnToPathState';
import { useIsCurrentLocationOnAWorkspace } from '@/domain-manager/hooks/useIsCurrentLocationOnAWorkspace';
import { isMinimalMetadataReadyState } from '@/metadata-store/states/isMinimalMetadataReadyState';
import { useDefaultHomePagePath } from '@/navigation/hooks/useDefaultHomePagePath';
import { objectMetadataItemsSelector } from '@/object-metadata/states/objectMetadataItemsSelector';
import { useOnboardingStatus } from '@/onboarding/hooks/useOnboardingStatus';
import { isOnboardingCheckoutPendingState } from '@/onboarding/states/isOnboardingCheckoutPendingState';
import { shouldOpenAiChatAfterOnboardingState } from '@/onboarding/states/shouldOpenAiChatAfterOnboardingState';
import { useAtomStateValue } from '@/ui/utilities/state/jotai/hooks/useAtomStateValue';
import { useIsWorkspaceActivationStatusEqualsTo } from '@/workspace/hooks/useIsWorkspaceActivationStatusEqualsTo';
import { isValidReturnToPath } from '@/auth/utils/isValidReturnToPath';
import { useQuery } from '@apollo/client/react';
import { isNonEmptyString } from '@sniptt/guards';
import { useLocation, useParams } from 'react-router-dom';
import { AppPath, SettingsPath } from 'searm-shared/types';
import { isDefined } from 'searm-shared/utils';
import { WorkspaceActivationStatus } from 'searm-shared/workspace';
import {
  FindOnePageLayoutTypeDocument,
  OnboardingStatus,
  PageLayoutType,
} from '~/generated-metadata/graphql';
import { isMatchingLocation } from '~/utils/isMatchingLocation';

const readReturnToPathFromUrlSearchParams = (): string | null => {
  const value = new URLSearchParams(window.location.search).get('returnToPath');

  return value && isValidReturnToPath(value) ? value : null;
};

export const usePageChangeEffectNavigateLocation = () => {
  const isLogged = useIsLogged();
  const currentWorkspace = useAtomStateValue(currentWorkspaceState);
  const { isOnAWorkspace } = useIsCurrentLocationOnAWorkspace();
  const onboardingStatus = useOnboardingStatus();
  const isWorkspaceSuspended = useIsWorkspaceActivationStatusEqualsTo(
    WorkspaceActivationStatus.SUSPENDED,
  );
  const { defaultHomePagePath } = useDefaultHomePagePath();
  const location = useLocation();

  const someMatchingLocationOf = (appPaths: AppPath[]): boolean =>
    appPaths.some((appPath) => isMatchingLocation(location, appPath));

  const params = useParams();

  const objectNamePlural = params.objectNamePlural ?? '';
  const objectMetadataItems = useAtomStateValue(objectMetadataItemsSelector);
  const objectMetadataItem = objectMetadataItems?.find(
    (objectMetadataItem) => objectMetadataItem.namePlural === objectNamePlural,
  );
  const isMinimalMetadataReady = useAtomStateValue(isMinimalMetadataReadyState);

  const pageLayoutId = params.pageLayoutId;
  const isOnPageLayoutPage = isMatchingLocation(
    location,
    AppPath.PageLayoutPage,
  );

  const { data: pageLayoutData, loading: isPageLayoutLoading } = useQuery(
    FindOnePageLayoutTypeDocument,
    {
      variables: { id: pageLayoutId ?? '' },
      skip: !isOnPageLayoutPage || !isDefined(pageLayoutId),
    },
  );
  const returnToPath = useAtomStateValue(returnToPathState);
  const resolvedReturnToPath = isNonEmptyString(returnToPath)
    ? returnToPath
    : readReturnToPathFromUrlSearchParams();

  const shouldOpenAiChatAfterOnboarding = useAtomStateValue(
    shouldOpenAiChatAfterOnboardingState,
  );
  const onboardingCompletedPath = shouldOpenAiChatAfterOnboarding
    ? AppPath.WorkspaceSetup
    : defaultHomePagePath;

  const isOnboardingCheckoutPending = useAtomStateValue(
    isOnboardingCheckoutPendingState,
  );

  if (
    (!isLogged || !isOnAWorkspace || !isDefined(currentWorkspace)) &&
    !someMatchingLocationOf([
      ...ONGOING_USER_CREATION_PATHS,
      AppPath.ResetPassword,
    ])
  ) {
    return AppPath.SignInUp;
  }

  if (isWorkspaceSuspended) {
    if (!isMatchingLocation(location, AppPath.SettingsCatchAll)) {
      return `${AppPath.SettingsCatchAll.replace('/*', '')}/${
        SettingsPath.Billing
      }`;
    }

    return;
  }

  if (
    onboardingStatus === OnboardingStatus.WORKSPACE_ACTIVATION &&
    !isMatchingLocation(location, AppPath.WorkspaceActivation)
  ) {
    return AppPath.WorkspaceActivation;
  }

  if (
    onboardingStatus === OnboardingStatus.PROFILE_CREATION &&
    !isMatchingLocation(location, AppPath.CreateProfile)
  ) {
    return AppPath.CreateProfile;
  }

  if (
    onboardingStatus === OnboardingStatus.SYNC_EMAIL &&
    !isMatchingLocation(location, AppPath.SyncEmails)
  ) {
    return AppPath.SyncEmails;
  }

  if (
    onboardingStatus === OnboardingStatus.APPS_INSTALLATION &&
    !isMatchingLocation(location, AppPath.InstallApps)
  ) {
    return AppPath.InstallApps;
  }

  if (
    onboardingStatus === OnboardingStatus.INVITE_TEAM &&
    !isMatchingLocation(location, AppPath.InviteTeam)
  ) {
    return AppPath.InviteTeam;
  }

  if (
    onboardingStatus === OnboardingStatus.COMPLETED &&
    someMatchingLocationOf([
      ...ONBOARDING_PATHS,
      ...ONGOING_USER_CREATION_PATHS,
    ]) &&
    !isMatchingLocation(location, AppPath.ResetPassword) &&
    isLogged &&
    isOnAWorkspace
  ) {
    if (
      isMatchingLocation(location, AppPath.PlanRequiredSuccess) &&
      isOnboardingCheckoutPending
    ) {
      return;
    }

    return resolvedReturnToPath ?? onboardingCompletedPath;
  }

  if (isMatchingLocation(location, AppPath.Index) && isLogged) {
    return resolvedReturnToPath ?? defaultHomePagePath;
  }

  if (
    isMinimalMetadataReady &&
    isMatchingLocation(location, AppPath.RecordIndexPage) &&
    !isDefined(objectMetadataItem)
  ) {
    return AppPath.NotFound;
  }

  if (
    isOnPageLayoutPage &&
    isDefined(pageLayoutId) &&
    !isPageLayoutLoading &&
    (!isDefined(pageLayoutData?.getPageLayout) ||
      pageLayoutData.getPageLayout.type !== PageLayoutType.STANDALONE_PAGE)
  ) {
    return AppPath.NotFound;
  }

  return;
};

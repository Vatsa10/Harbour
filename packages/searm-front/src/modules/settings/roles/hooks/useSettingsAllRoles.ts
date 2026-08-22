import { settingsPersistedRoleFamilyState } from '@/settings/roles/states/settingsPersistedRoleFamilyState';
import { settingsRoleIdsState } from '@/settings/roles/states/settingsRoleIdsState';
import { useAtomStateValue } from '@/ui/utilities/state/jotai/hooks/useAtomStateValue';
import { useStore } from 'jotai';
import { isDefined } from 'searm-shared/utils';

export const useSettingsAllRoles = () => {
  // oxlint-disable-next-line searm/matching-state-variable
  const roleIds = useAtomStateValue(settingsRoleIdsState);
  const store = useStore();

  const roles = roleIds
    .map((roleId) =>
      store.get(settingsPersistedRoleFamilyState.atomFamily(roleId)),
    )
    .filter(isDefined);

  return roles;
};

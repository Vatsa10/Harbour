import { ChatReferenceChipDisplay } from '@/ai/components/ChatReferenceChipDisplay';
import { fieldMetadataItemByIdSelector } from '@/object-metadata/states/fieldMetadataItemByIdSelector';
import { useHasPermissionFlag } from '@/settings/roles/hooks/useHasPermissionFlag';
import { useAtomFamilySelectorValue } from '@/ui/utilities/state/jotai/hooks/useAtomFamilySelectorValue';
import { SettingsPath } from 'searm-shared/types';
import { getSettingsPath, isDefined } from 'searm-shared/utils';
import { useIcons } from 'searm-ui/icon';
import { useTheme } from 'searm-ui/theme-constants';
import { PermissionFlagType } from '~/generated-metadata/graphql';

type FieldMetadataLinkProps = {
  fieldMetadataItemId: string;
  displayName: string;
};

export const FieldMetadataLink = ({
  fieldMetadataItemId,
  displayName,
}: FieldMetadataLinkProps) => {
  const theme = useTheme();
  const { getIcon } = useIcons();

  const { foundFieldMetadataItem, foundObjectMetadataItem } =
    useAtomFamilySelectorValue(fieldMetadataItemByIdSelector, {
      fieldMetadataItemId,
    });

  const hasDataModelPermission = useHasPermissionFlag(
    PermissionFlagType.DATA_MODEL,
  );

  if (
    !isDefined(foundFieldMetadataItem) ||
    !isDefined(foundObjectMetadataItem)
  ) {
    return <span>{displayName}</span>;
  }

  const Icon = getIcon(foundFieldMetadataItem.icon);

  return (
    <ChatReferenceChipDisplay
      displayName={displayName}
      to={
        hasDataModelPermission
          ? getSettingsPath(SettingsPath.ObjectFieldEdit, {
              objectNamePlural: foundObjectMetadataItem.namePlural,
              fieldName: foundFieldMetadataItem.name,
            })
          : undefined
      }
      leftComponent={
        <Icon size={theme.icon.size.sm} stroke={theme.icon.stroke.sm} />
      }
    />
  );
};

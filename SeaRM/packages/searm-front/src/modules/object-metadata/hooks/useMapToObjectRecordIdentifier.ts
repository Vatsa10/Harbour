import { useObjectMetadataItem } from '@/object-metadata/hooks/useObjectMetadataItem';
import { getObjectRecordIdentifier } from '@/object-metadata/utils/getObjectRecordIdentifier';
import { type ObjectRecord } from '@/object-record/types/ObjectRecord';

export const useMapToObjectRecordIdentifier = ({
  objectNameSingular,
  allowRequestsToSearmIcons,
}: {
  objectNameSingular: string;
  allowRequestsToSearmIcons: boolean;
}) => {
  const { objectMetadataItem } = useObjectMetadataItem({
    objectNameSingular,
  });

  const mapToObjectRecordIdentifier = (record: ObjectRecord) => {
    return getObjectRecordIdentifier({
      objectMetadataItem,
      record,
      allowRequestsToSearmIcons,
    });
  };

  return { mapToObjectRecordIdentifier };
};

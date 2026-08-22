import { type GuidedImportReview } from '@/object-record/spreadsheet-import/types/GuidedImportPreview';
import { createAtomState } from '@/ui/utilities/state/jotai/utils/createAtomState';

// Holds a staged, prepared-but-not-started import batch while the human looks
// at what it is about to do. Nothing writes to a customer record until this is
// confirmed, which is the whole point of the review step.
export const guidedImportReviewState = createAtomState<GuidedImportReview | null>(
  {
    key: 'guidedImportReviewState',
    defaultValue: null,
  },
);

import { useMutation, useQuery } from '@apollo/client/react';
import { useState } from 'react';

import { GENERATE_RECORD_BRIEF } from '@/record-brief/graphql/mutations/generateRecordBrief';
import { RECORD_BRIEF } from '@/record-brief/graphql/queries/recordBrief';
import {
  type BriefRefusalReason,
  type GenerateRecordBriefMutationResult,
  type RecordBrief,
  type RecordBriefQueryResult,
  type RecordBriefQueryVariables,
} from '@/record-brief/types/RecordBrief';

type UseRecordBriefResult = {
  brief: RecordBrief | null;
  loading: boolean;
  isGenerating: boolean;
  refusalReason: BriefRefusalReason | null;
  generateBrief: () => Promise<void>;
};

export const useRecordBrief = ({
  objectNameSingular,
  recordId,
}: RecordBriefQueryVariables): UseRecordBriefResult => {
  // Only set by an explicit generate attempt. A record that simply has no
  // brief stored shows nothing at all — silence is the resting state, and a
  // standing "no evidence" notice on every record would be its own noise.
  const [refusalReason, setRefusalReason] =
    useState<BriefRefusalReason | null>(null);

  const { data, loading } = useQuery<
    RecordBriefQueryResult,
    RecordBriefQueryVariables
  >(RECORD_BRIEF, {
    variables: { objectNameSingular, recordId },
    // A brief is background colour, never the reason the page exists. If the
    // query fails — including the permission failure for a workspace member
    // without AI access — the panel stays absent rather than showing an error
    // banner on an otherwise healthy record page.
    errorPolicy: 'all',
  });

  const [runGenerateBrief, { loading: isGenerating }] =
    useMutation<GenerateRecordBriefMutationResult>(GENERATE_RECORD_BRIEF, {
      variables: { objectNameSingular, recordId },
      // The mutation deletes a stale brief when it refuses, so the cached
      // query has to be re-read rather than patched from the result.
      refetchQueries: [
        {
          query: RECORD_BRIEF,
          variables: { objectNameSingular, recordId },
        },
      ],
      errorPolicy: 'all',
    });

  const generateBrief = async () => {
    const result = await runGenerateBrief();

    setRefusalReason(result.data?.generateRecordBrief.refusalReason ?? null);
  };

  return {
    brief: data?.recordBrief ?? null,
    loading,
    isGenerating,
    refusalReason,
    generateBrief,
  };
};

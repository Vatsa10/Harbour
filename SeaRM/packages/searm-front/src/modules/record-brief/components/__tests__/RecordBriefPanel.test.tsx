import { MockedProvider } from '@apollo/client/testing/react';
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GraphQLError } from 'graphql';
import { type ReactNode } from 'react';

import { RecordBriefPanel } from '@/record-brief/components/RecordBriefPanel';
import { GENERATE_RECORD_BRIEF } from '@/record-brief/graphql/mutations/generateRecordBrief';
import { RECORD_BRIEF } from '@/record-brief/graphql/queries/recordBrief';

const OBJECT_NAME_SINGULAR = 'person';
const RECORD_ID = '20202020-0000-4000-8000-000000000001';

const variables = {
  objectNameSingular: OBJECT_NAME_SINGULAR,
  recordId: RECORD_ID,
};

const brief = {
  __typename: 'RecordBrief',
  id: '20202020-0000-4000-8000-0000000000b1',
  objectNameSingular: OBJECT_NAME_SINGULAR,
  recordId: RECORD_ID,
  narrative: 'Ada Lovelace is Head of Analysis. Ada Lovelace works at Difference Engine Ltd.',
  sections: { currentRole: 'Head of Analysis', company: 'Difference Engine Ltd' },
  factIds: [
    '20202020-0000-4000-8000-0000000000f1',
    '20202020-0000-4000-8000-0000000000f2',
  ],
  oldestObservedAt: '2026-01-02T00:00:00.000Z',
  refreshedAt: '2026-01-03T00:00:00.000Z',
};

const emptyQueryMock = {
  request: { query: RECORD_BRIEF, variables },
  result: { data: { recordBrief: null } },
};

const briefQueryMock = {
  request: { query: RECORD_BRIEF, variables },
  result: { data: { recordBrief: brief } },
};

const createWrapper =
  (mocks: readonly unknown[]) =>
  ({ children }: { children: ReactNode }) => (
    <I18nProvider i18n={i18n}>
      <MockedProvider mocks={mocks as never}>{children}</MockedProvider>
    </I18nProvider>
  );

const renderPanel = (mocks: readonly unknown[]) =>
  render(<RecordBriefPanel {...variables} />, {
    wrapper: createWrapper(mocks),
  });

describe('RecordBriefPanel', () => {
  beforeAll(() => {
    i18n.loadAndActivate({ locale: 'en', messages: {} });
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should render the narrative and the structured sections when a brief exists', async () => {
    renderPanel([briefQueryMock]);

    expect(await screen.findByText(brief.narrative)).toBeInTheDocument();
    expect(screen.getByText('Current role')).toBeInTheDocument();
    expect(screen.getByText('Head of Analysis')).toBeInTheDocument();
    expect(screen.getByText('Company')).toBeInTheDocument();
    expect(screen.getByText(/2 sourced facts/)).toBeInTheDocument();
  });

  it('should write nothing but the generate action when the record has no brief', async () => {
    renderPanel([emptyQueryMock]);

    expect(
      await screen.findByRole('button', { name: /generate/i }),
    ).toBeInTheDocument();
    expect(screen.queryByText(brief.narrative)).not.toBeInTheDocument();
    expect(screen.queryByText(/sourced facts/)).not.toBeInTheDocument();
  });

  it('should state that nothing was written when generation is refused for lack of evidence', async () => {
    renderPanel([
      emptyQueryMock,
      {
        request: { query: GENERATE_RECORD_BRIEF, variables },
        result: {
          data: {
            generateRecordBrief: {
              __typename: 'RecordBriefGenerationResult',
              brief: null,
              refusalReason: 'NO_QUALIFYING_EVIDENCE',
            },
          },
        },
      },
      emptyQueryMock,
    ]);

    await userEvent.click(
      await screen.findByRole('button', { name: /generate/i }),
    );

    expect(
      await screen.findByText(/nothing about this record is backed by/i),
    ).toBeInTheDocument();
    // The refusal is a sentence about absence, never a paragraph standing in
    // for one: no narrative and no sections may appear.
    expect(screen.queryByText(/sourced facts/)).not.toBeInTheDocument();
  });

  it('should stay silent rather than surface an error when the query fails', async () => {
    renderPanel([
      {
        request: { query: RECORD_BRIEF, variables },
        result: { errors: [new GraphQLError('FORBIDDEN')] },
      },
    ]);

    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /generate/i }),
      ).toBeInTheDocument(),
    );

    expect(screen.queryByText(/FORBIDDEN/)).not.toBeInTheDocument();
  });
});

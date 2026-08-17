import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ProposalDiffTable } from '@/settings/ai-approvals/components/ProposalDiffTable';

const items = [
  {
    id: 'item-1',
    actionType: 'UPDATE_RECORD',
    objectNameSingular: 'person',
    recordId: 'record-1',
    toolId: null,
    payload: { jobTitle: 'Head of Sales', city: 'Berlin' },
    baseline: { jobTitle: 'Sales Rep', city: 'Munich' },
    status: 'PENDING',
    error: null,
    // jobTitle is fact-backed; city deliberately is not, so one item covers
    // both the citation and the no-citation case on adjacent rows.
    facts: [
      {
        id: 'fact-1',
        fieldName: 'jobTitle',
        strength: 'WEAK',
        hasConflict: false,
        sourceType: 'WEB_SEARCH',
        sourceLocator: 'https://example.com/about',
        observedAt: '2026-08-01T00:00:00.000Z',
      },
    ],
  },
  {
    id: 'item-2',
    actionType: 'DELETE_RECORD',
    objectNameSingular: 'company',
    recordId: 'record-2',
    toolId: null,
    payload: {},
    baseline: { updatedAt: '2026-01-01' },
    status: 'PENDING',
    error: null,
    facts: [],
  },
];

describe('ProposalDiffTable', () => {
  it('should show the current and proposed value for each field', () => {
    render(
      <ProposalDiffTable
        items={items}
        onApprove={jest.fn()}
        onReject={jest.fn()}
      />,
    );

    expect(screen.getByText('Sales Rep')).toBeInTheDocument();
    expect(screen.getByText('Head of Sales')).toBeInTheDocument();
    expect(screen.getByText('Munich')).toBeInTheDocument();
    expect(screen.getByText('Berlin')).toBeInTheDocument();
  });

  // A delete used to render zero rows: the reviewer approved a blank table.
  it('should describe an item that has no field-level diff', () => {
    render(
      <ProposalDiffTable
        items={items}
        onApprove={jest.fn()}
        onReject={jest.fn()}
      />,
    );

    expect(screen.getByText(/Delete company record-2/)).toBeInTheDocument();
  });

  it('should render one checkbox per item, not one per field', () => {
    render(
      <ProposalDiffTable
        items={items}
        onApprove={jest.fn()}
        onReject={jest.fn()}
      />,
    );

    expect(screen.getAllByRole('checkbox')).toHaveLength(2);
  });

  it('should approve only the items left selected', async () => {
    const onApprove = jest.fn();

    render(
      <ProposalDiffTable
        items={items}
        onApprove={onApprove}
        onReject={jest.fn()}
      />,
    );

    await userEvent.click(
      screen.getByRole('checkbox', { name: /Delete company/i }),
    );
    await userEvent.click(
      screen.getByRole('button', { name: /approve selected/i }),
    );

    expect(onApprove).toHaveBeenCalledWith(['item-1']);
  });

  it('should warn that an item without a baseline is unprotected', () => {
    render(
      <ProposalDiffTable
        items={[
          {
            ...items[1],
            id: 'item-3',
            actionType: 'DELETE_RECORDS',
            baseline: {},
          },
        ]}
        onApprove={jest.fn()}
        onReject={jest.fn()}
      />,
    );

    expect(
      screen.getByText(
        /not protected against edits made since it was proposed/,
      ),
    ).toBeInTheDocument();
  });

  it('should flag a conflicted item', () => {
    render(
      <ProposalDiffTable
        items={[{ ...items[0], status: 'CONFLICTED' }]}
        onApprove={jest.fn()}
        onReject={jest.fn()}
      />,
    );

    expect(
      screen.getByText(
        /could not be re-verified.*may have changed, been deleted, or become inaccessible/,
      ),
    ).toBeInTheDocument();
  });

  it('should show the strength and source for a fact-backed field', () => {
    render(
      <ProposalDiffTable
        items={items}
        onApprove={jest.fn()}
        onReject={jest.fn()}
      />,
    );

    const citation = screen.getByText(/WEAK/);

    expect(citation).toHaveTextContent('WEB_SEARCH');
    expect(citation).toHaveTextContent('https://example.com/about');
    // The citation belongs to the jobTitle row, not the city row.
    expect(citation.closest('tr')).toHaveTextContent('jobTitle');
  });

  // I7: the earlier version of this test asserted `.not.toHaveTextContent('WEAK')`
  // on the Berlin row, which passed against the unmodified component because
  // nothing rendered 'WEAK' anywhere — a test that could never go red. Assert
  // instead that exactly one citation exists and it is not on the city row.
  it('should show no citation on a field with no backing fact', () => {
    render(
      <ProposalDiffTable
        items={items}
        onApprove={jest.fn()}
        onReject={jest.fn()}
      />,
    );

    expect(screen.getAllByText(/WEAK|STRONG/)).toHaveLength(1);

    const cityRow = screen.getByText('Berlin').closest('tr');

    expect(cityRow).not.toBeNull();
    expect(cityRow).not.toHaveTextContent('WEB_SEARCH');
  });

  it('should flag a fact whose sources disagree', () => {
    render(
      <ProposalDiffTable
        items={[
          {
            ...items[0],
            facts: [{ ...items[0].facts[0], hasConflict: true }],
          },
        ]}
        onApprove={jest.fn()}
        onReject={jest.fn()}
      />,
    );

    expect(screen.getByText(/Conflicting sources/)).toBeInTheDocument();
  });
  // Important 2. Freshness was queried, typed, put in this fixture and never
  // rendered, so a reviewer could not tell a citation observed this morning
  // from one observed two years ago.
  it('should show the reviewer when the citation was observed', () => {
    render(
      <ProposalDiffTable
        items={items}
        onApprove={jest.fn()}
        onReject={jest.fn()}
      />,
    );

    expect(screen.getByText(/observed 2026-08-01/)).toBeInTheDocument();
  });

  it('should render the citation without a date rather than an invalid one', () => {
    render(
      <ProposalDiffTable
        items={[
          {
            ...items[0],
            facts: [{ ...items[0].facts[0], observedAt: null }],
          },
        ]}
        onApprove={jest.fn()}
        onReject={jest.fn()}
      />,
    );

    expect(screen.getByText(/WEB_SEARCH/)).toBeInTheDocument();
    expect(screen.queryByText(/observed/)).not.toBeInTheDocument();
  });
});

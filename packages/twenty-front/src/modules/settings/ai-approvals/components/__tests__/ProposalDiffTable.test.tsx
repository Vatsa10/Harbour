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
      screen.getByText(/This record changed since it was proposed/),
    ).toBeInTheDocument();
  });
});

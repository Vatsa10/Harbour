import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ProposalDiffTable } from '@/settings/ai-approvals/components/ProposalDiffTable';

const items = [
  {
    id: 'item-1',
    actionType: 'UPDATE_RECORD',
    objectNameSingular: 'person',
    recordId: 'record-1',
    payload: { jobTitle: 'Head of Sales' },
    baseline: { jobTitle: 'Sales Rep' },
    status: 'PENDING',
    error: null,
  },
  {
    id: 'item-2',
    actionType: 'UPDATE_RECORD',
    objectNameSingular: 'person',
    recordId: 'record-1',
    payload: { city: 'Berlin' },
    baseline: { city: 'Munich' },
    status: 'PENDING',
    error: null,
  },
];

describe('ProposalDiffTable', () => {
  it('should show the current and proposed value for each field', () => {
    render(<ProposalDiffTable items={items} onApprove={jest.fn()} onReject={jest.fn()} />);

    expect(screen.getByText('Sales Rep')).toBeInTheDocument();
    expect(screen.getByText('Head of Sales')).toBeInTheDocument();
    expect(screen.getByText('Munich')).toBeInTheDocument();
    expect(screen.getByText('Berlin')).toBeInTheDocument();
  });

  it('should approve only the items left selected', async () => {
    const onApprove = jest.fn();

    render(<ProposalDiffTable items={items} onApprove={onApprove} onReject={jest.fn()} />);

    await userEvent.click(screen.getByRole('checkbox', { name: /city/i }));
    await userEvent.click(screen.getByRole('button', { name: /approve selected/i }));

    expect(onApprove).toHaveBeenCalledWith(['item-1']);
  });
});

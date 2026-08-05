import { useState } from 'react';
import { styled } from '@linaria/react';
import { themeCssVariables } from 'twenty-ui/theme-constants';

import { Button } from 'twenty-ui/input';

type ProposalItem = {
  id: string;
  actionType: string;
  objectNameSingular: string | null;
  recordId: string | null;
  payload: Record<string, unknown>;
  baseline: Record<string, unknown>;
  status: string;
  error: string | null;
};

type ProposalDiffTableProps = {
  items: ProposalItem[];
  onApprove: (selectedItemIds: string[]) => void;
  onReject: () => void;
};

const StyledTable = styled.table`
  border-collapse: collapse;
  width: 100%;
`;

const StyledCell = styled.td`
  border-bottom: 1px solid ${themeCssVariables.border.color.light};
  padding: ${themeCssVariables.spacing[2]};
`;

const StyledActions = styled.div`
  display: flex;
  gap: ${themeCssVariables.spacing[2]};
  padding-top: ${themeCssVariables.spacing[3]};
`;

const formatValue = (value: unknown): string =>
  typeof value === 'string' ? value : JSON.stringify(value ?? '—');

export const ProposalDiffTable = ({
  items,
  onApprove,
  onReject,
}: ProposalDiffTableProps) => {
  const [deselectedItemIds, setDeselectedItemIds] = useState<string[]>([]);

  const toggleItem = (itemId: string) => {
    setDeselectedItemIds((previous) =>
      previous.includes(itemId)
        ? previous.filter((id) => id !== itemId)
        : [...previous, itemId],
    );
  };

  const selectedItemIds = items
    .map((item) => item.id)
    .filter((itemId) => !deselectedItemIds.includes(itemId));

  return (
    <div>
      <StyledTable>
        <tbody>
          {items.map((item) =>
            Object.keys(item.payload).map((fieldName) => (
              <tr key={`${item.id}-${fieldName}`}>
                <StyledCell>
                  <input
                    type="checkbox"
                    aria-label={fieldName}
                    checked={!deselectedItemIds.includes(item.id)}
                    onChange={() => toggleItem(item.id)}
                  />
                </StyledCell>
                <StyledCell>{fieldName}</StyledCell>
                <StyledCell>{formatValue(item.baseline[fieldName])}</StyledCell>
                <StyledCell>{formatValue(item.payload[fieldName])}</StyledCell>
              </tr>
            )),
          )}
        </tbody>
      </StyledTable>
      <StyledActions>
        <Button
          title="Approve selected"
          accent="blue"
          onClick={() => onApprove(selectedItemIds)}
        />
        <Button title="Reject" accent="danger" onClick={onReject} />
      </StyledActions>
    </div>
  );
};

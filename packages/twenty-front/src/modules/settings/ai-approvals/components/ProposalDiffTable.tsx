import { useState } from 'react';
import { styled } from '@linaria/react';
import { themeCssVariables } from 'twenty-ui/theme-constants';

import { Button } from 'twenty-ui/input';

type ProposalItem = {
  id: string;
  actionType: string;
  objectNameSingular: string | null;
  recordId: string | null;
  toolId?: string | null;
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
  vertical-align: top;
`;

const StyledFieldRow = styled.tr`
  color: ${themeCssVariables.font.color.secondary};
`;

const StyledNote = styled.div`
  color: ${themeCssVariables.font.color.tertiary};
  font-size: ${themeCssVariables.font.size.sm};
`;

const StyledConflict = styled.span`
  color: ${themeCssVariables.font.color.danger};
`;

const StyledActions = styled.div`
  display: flex;
  gap: ${themeCssVariables.spacing[2]};
  padding-top: ${themeCssVariables.spacing[3]};
`;

const EMPTY_VALUE = '—';

const formatValue = (value: unknown): string => {
  if (value === null || value === undefined || value === '') {
    return EMPTY_VALUE;
  }

  return typeof value === 'string' ? value : JSON.stringify(value);
};

// A delete, a bulk write, or an outbound send has no field-level diff, so the
// row describes the action instead of rendering an empty table.
const describeItem = (item: ProposalItem): string => {
  const target = item.objectNameSingular ?? item.toolId ?? 'unknown target';

  switch (item.actionType) {
    case 'DELETE_RECORD':
      return `Delete ${target} ${item.recordId ?? ''}`.trim();
    case 'DELETE_RECORDS':
      return `Delete every matching ${target}`;
    case 'CREATE_RECORDS':
      return `Create several ${target} records`;
    case 'UPSERT_RECORDS':
      return `Create or update several ${target} records`;
    case 'UPDATE_RECORDS':
      return `Update every matching ${target}`;
    case 'SEND_EMAIL':
      return 'Send an email';
    case 'CREATE_CALENDAR_EVENT':
      return 'Create a calendar event';
    case 'STATIC_TOOL':
      return `Run ${target}`;
    default:
      return `${item.actionType} on ${target}`;
  }
};

const FIELD_DIFF_ACTION_TYPES = ['CREATE_RECORD', 'UPDATE_RECORD'];

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
          {items.map((item) => {
            const fieldNames = FIELD_DIFF_ACTION_TYPES.includes(item.actionType)
              ? Object.keys(item.payload)
              : [];

            return [
              // One checkbox per item, on the item's own row: a per-field
              // checkbox would silently toggle its siblings.
              <tr key={item.id}>
                <StyledCell>
                  <input
                    type="checkbox"
                    aria-label={describeItem(item)}
                    checked={!deselectedItemIds.includes(item.id)}
                    onChange={() => toggleItem(item.id)}
                  />
                </StyledCell>
                <StyledCell colSpan={3}>
                  <div>{describeItem(item)}</div>
                  {item.status === 'CONFLICTED' && (
                    <StyledConflict>
                      This record changed since it was proposed.
                    </StyledConflict>
                  )}
                  {fieldNames.length === 0 &&
                    Object.keys(item.baseline).length === 0 && (
                      <StyledNote>
                        No field-level diff is available for this action, and it
                        is not protected against edits made since it was
                        proposed.
                      </StyledNote>
                    )}
                </StyledCell>
              </tr>,
              ...fieldNames.map((fieldName) => (
                <StyledFieldRow key={`${item.id}-${fieldName}`}>
                  <StyledCell />
                  <StyledCell>{fieldName}</StyledCell>
                  <StyledCell>{formatValue(item.baseline[fieldName])}</StyledCell>
                  <StyledCell>{formatValue(item.payload[fieldName])}</StyledCell>
                </StyledFieldRow>
              )),
            ];
          })}
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

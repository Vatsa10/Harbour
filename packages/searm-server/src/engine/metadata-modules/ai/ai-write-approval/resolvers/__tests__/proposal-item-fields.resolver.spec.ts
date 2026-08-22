import { ProposalItemFieldsResolver } from 'src/engine/metadata-modules/ai/ai-write-approval/resolvers/proposal-item-fields.resolver';

describe('ProposalItemFieldsResolver', () => {
  const factService = { findProposalItemFacts: jest.fn() };

  const buildResolver = () =>
    new ProposalItemFieldsResolver(factService as never);

  const workspace = { id: 'workspace-1' } as never;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should return the flat citation projection for the item factIds', async () => {
    const projection = [
      {
        id: 'fact-1',
        fieldName: 'jobTitle',
        strength: 'WEAK',
        hasConflict: false,
        sourceType: 'WEB_SEARCH',
        sourceLocator: 'https://example.com/about',
        observedAt: new Date('2026-08-01T00:00:00.000Z'),
      },
    ];

    factService.findProposalItemFacts.mockResolvedValue(projection);

    const facts = await buildResolver().facts(
      { factIds: ['fact-1'] } as never,
      workspace,
    );

    expect(factService.findProposalItemFacts).toHaveBeenCalledWith(
      'workspace-1',
      ['fact-1'],
    );
    expect(facts).toEqual(projection);
  });

  // A chat-originated item, and every outbound send.
  it('should return an empty list without querying when the item has no facts', async () => {
    const facts = await buildResolver().facts(
      { factIds: [] } as never,
      workspace,
    );

    expect(facts).toEqual([]);
    expect(factService.findProposalItemFacts).not.toHaveBeenCalled();
  });

  // The column is jsonb NOT NULL DEFAULT '[]', but a proposal item created
  // before Task 8's migration ran still arrives here with factIds undefined.
  it('should tolerate an item whose factIds are undefined', async () => {
    const facts = await buildResolver().facts({} as never, workspace);

    expect(facts).toEqual([]);
  });
});

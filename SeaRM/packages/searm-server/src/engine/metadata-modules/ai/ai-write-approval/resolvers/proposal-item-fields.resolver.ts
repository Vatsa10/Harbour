import { Parent, ResolveField, Resolver } from '@nestjs/graphql';

import { isDefined } from 'searm-shared/utils';

import { type FlatWorkspace } from 'src/engine/core-modules/workspace/types/flat-workspace.type';
import { AuthWorkspace } from 'src/engine/decorators/auth/auth-workspace.decorator';
import { FactService } from 'src/engine/metadata-modules/ai/ai-research/services/fact.service';
import {
  ProposalItemDTO,
  ProposalItemFactDTO,
} from 'src/engine/metadata-modules/ai/ai-write-approval/dtos/proposal.dto';

@Resolver(() => ProposalItemDTO)
export class ProposalItemFieldsResolver {
  // FactService is the only Fact surface this module may touch (Owner
  // Decision 1). No Repository<FactEntity> and no FactEntity import appear
  // anywhere in ai-write-approval.
  constructor(private readonly factService: FactService) {}

  @ResolveField(() => [ProposalItemFactDTO])
  async facts(
    @Parent() item: ProposalItemDTO,
    // FactService.findProposalItemFacts is workspace-scoped: without this,
    // a caller holding another tenant's fact id in a spoofed factIds array
    // would be handed that tenant's citation.
    @AuthWorkspace() workspace: FlatWorkspace,
  ): Promise<ProposalItemFactDTO[]> {
    // Most items have no facts — every chat-originated write, every outbound
    // send. Short-circuiting here is what keeps opening the inbox cheap.
    if (!isDefined(item.factIds) || item.factIds.length === 0) {
      return [];
    }

    return this.factService.findProposalItemFacts(workspace.id, item.factIds);
  }
}

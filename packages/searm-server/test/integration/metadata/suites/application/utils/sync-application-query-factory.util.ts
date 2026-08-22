import gql from 'graphql-tag';
import { type Manifest } from 'searm-shared/application';

export const syncApplicationQueryFactory = ({
  manifest,
  dryRun,
}: {
  manifest: Manifest;
  dryRun?: boolean;
}) => ({
  query: gql`
    mutation SyncApplication($manifest: JSON!, $dryRun: Boolean) {
      syncApplication(manifest: $manifest, dryRun: $dryRun) {
        applicationUniversalIdentifier
        actions
      }
    }
  `,
  variables: {
    manifest,
    dryRun,
  },
});

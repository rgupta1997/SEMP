import { MembersPage } from '../MembersPage';

/** Members, inside the Administration rail. */
export const MembersPanel = ({ orgId }: { orgId: string }) => <MembersPage embedded orgId={orgId} />;

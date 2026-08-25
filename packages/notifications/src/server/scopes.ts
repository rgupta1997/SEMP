export interface EventScopes {
    isSuper: boolean;
    userId: string;

    adminOrgIds: Set<string>;

    organiserEventIds: Set<string>;
    officialEventIds: Set<string>;
    captainEventIds: Set<string>;
    participantEventIds: Set<string>;
    pocEventIds: Set<string>;

    teamIds: Set<string>;
    
    allRelatedEventIds: Set<string>;
    instCaptEventIds: Set<string>;
    postableEventIds: Set<string>;
}
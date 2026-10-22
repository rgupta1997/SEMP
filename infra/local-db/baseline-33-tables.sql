--
-- PostgreSQL database dump
--

\restrict fHE5dr2RcjWqNdoYt8hlOPwNqCi8AM3Wbuj4dGfUKiG0kvjpkBdGduoDVzPtCGv

-- Dumped from database version 17.6
-- Dumped by pg_dump version 18.6

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--



--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--



--
-- Name: rls_auto_enable(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rls_auto_enable() RETURNS event_trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$$;


--
-- Name: set_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: championship_invitations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.championship_invitations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    championship_id uuid NOT NULL,
    org_name character varying NOT NULL,
    poc_mobile character varying,
    status character varying DEFAULT 'pending'::character varying NOT NULL,
    invited_by uuid NOT NULL,
    organization_id uuid,
    accepted_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    responded_at timestamp with time zone,
    CONSTRAINT championship_invitations_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'accepted'::character varying, 'declined'::character varying, 'cancelled'::character varying])::text[])))
);


--
-- Name: TABLE championship_invitations; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.championship_invitations IS 'Host invitations to a specific organization (picked from the master list); the org''s owners/admins see them on login and accepting creates a pending championship_organizations enrollment.';


--
-- Name: championship_officials; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.championship_officials (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    championship_id uuid NOT NULL,
    user_id uuid NOT NULL,
    assigned_by uuid,
    assigned_at timestamp with time zone DEFAULT now() NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    notes text
);


--
-- Name: TABLE championship_officials; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.championship_officials IS 'Officials assigned to specific events - enables multi-tenant isolation';


--
-- Name: championship_organizations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.championship_organizations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    championship_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    status character varying DEFAULT 'pending'::character varying NOT NULL,
    applied_by uuid NOT NULL,
    reviewed_by uuid,
    rejection_note text,
    applied_at timestamp with time zone DEFAULT now() NOT NULL,
    reviewed_at timestamp with time zone,
    CONSTRAINT event_institutions_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'approved'::character varying, 'rejected'::character varying])::text[])))
);


--
-- Name: championships; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.championships (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying NOT NULL,
    slug character varying NOT NULL,
    description text,
    venue character varying,
    start_date date NOT NULL,
    end_date date NOT NULL,
    status character varying DEFAULT 'draft'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT events_status_check CHECK (((status)::text = ANY ((ARRAY['draft'::character varying, 'registration_open'::character varying, 'ongoing'::character varying, 'completed'::character varying])::text[])))
);


--
-- Name: demo_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.demo_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying NOT NULL,
    email character varying NOT NULL,
    organization character varying,
    role character varying,
    sport character varying,
    phone character varying,
    message text,
    status character varying DEFAULT 'new'::character varying NOT NULL,
    handled_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: disciplines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.disciplines (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    sport_id uuid NOT NULL,
    name character varying NOT NULL,
    description character varying,
    entry_type character varying DEFAULT 'team'::character varying NOT NULL,
    squad_min smallint DEFAULT 1 NOT NULL,
    squad_max smallint DEFAULT 15 NOT NULL,
    display_order integer DEFAULT 0 NOT NULL,
    CONSTRAINT disciplines_entry_type_check CHECK (((entry_type)::text = ANY ((ARRAY['team'::character varying, 'individual'::character varying, 'doubles'::character varying, 'relay'::character varying])::text[])))
);


--
-- Name: feedback; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.feedback (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    message text NOT NULL,
    name character varying,
    email character varying,
    context character varying,
    championship_id uuid,
    user_id uuid,
    status character varying DEFAULT 'new'::character varying NOT NULL,
    handled_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: fixture_awards; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fixture_awards (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    fixture_id uuid NOT NULL,
    recipient_user_id uuid NOT NULL,
    award_name character varying(120) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: fixture_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fixture_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    fixture_id uuid NOT NULL,
    rubber_key character varying(40),
    team_side character(1),
    event_key character varying(40) NOT NULL,
    label character varying(120) NOT NULL,
    points integer DEFAULT 0 NOT NULL,
    player_user_id uuid,
    segment character varying(40),
    seq integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT fixture_events_team_side_check CHECK ((team_side = ANY (ARRAY['A'::bpchar, 'B'::bpchar])))
);


--
-- Name: fixtures; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fixtures (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tournament_discipline_id uuid NOT NULL,
    home_team_id uuid,
    away_team_id uuid,
    venue_ground_id uuid,
    round character varying,
    pool_number smallint,
    bracket_position integer,
    scheduled_at timestamp with time zone,
    duration_minutes integer,
    status character varying DEFAULT 'scheduled'::character varying NOT NULL,
    official_id uuid,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    home_score integer,
    away_score integer,
    winner_team_id uuid,
    live_state jsonb DEFAULT '{}'::jsonb NOT NULL,
    live_log jsonb DEFAULT '[]'::jsonb NOT NULL,
    CONSTRAINT fixtures_status_check CHECK (((status)::text = ANY ((ARRAY['scheduled'::character varying, 'live'::character varying, 'completed'::character varying, 'postponed'::character varying, 'cancelled'::character varying, 'bye'::character varying, 'walkover'::character varying])::text[])))
);


--
-- Name: notification_reactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notification_reactions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    notification_id uuid NOT NULL,
    user_id uuid NOT NULL,
    reaction character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: notification_reads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notification_reads (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    notification_id uuid NOT NULL,
    user_id uuid NOT NULL,
    read_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    championship_id uuid,
    sender_id uuid,
    type character varying DEFAULT 'manual'::character varying NOT NULL,
    audience character varying DEFAULT 'all'::character varying NOT NULL,
    title character varying NOT NULL,
    body text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    organization_id uuid,
    target_user_id uuid,
    CONSTRAINT notifications_audience_check CHECK (((audience)::text = ANY ((ARRAY['all'::character varying, 'organizations_captains'::character varying, 'org_admins'::character varying])::text[]))),
    CONSTRAINT notifications_type_check CHECK (((type)::text = ANY ((ARRAY['manual'::character varying, 'event_lifecycle'::character varying, 'enrollment_approved'::character varying, 'org_join_request'::character varying, 'org_join_approved'::character varying, 'org_join_declined'::character varying])::text[])))
);


--
-- Name: TABLE notifications; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.notifications IS 'Event-scoped notifications; audience controls who can see each message';


--
-- Name: COLUMN notifications.organization_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.notifications.organization_id IS 'When set with audience=org_admins, the notification is visible to that organization''s owners/admins (used for join requests). Mutually exclusive with championship_id in practice.';


--
-- Name: COLUMN notifications.target_user_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.notifications.target_user_id IS 'When set, the notification is a direct message visible only to this user (e.g. join request approved/declined).';


--
-- Name: organization_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.organization_members (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    role character varying DEFAULT 'member'::character varying NOT NULL,
    status character varying DEFAULT 'active'::character varying NOT NULL,
    joined_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT organization_members_role_check CHECK (((role)::text = ANY ((ARRAY['owner'::character varying, 'admin'::character varying, 'captain'::character varying, 'member'::character varying, 'alumni'::character varying])::text[]))),
    CONSTRAINT organization_members_status_check CHECK (((status)::text = ANY ((ARRAY['active'::character varying, 'past'::character varying, 'pending'::character varying, 'rejected'::character varying])::text[])))
);


--
-- Name: organizations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.organizations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying NOT NULL,
    short_name character varying,
    code character varying,
    logo_url text,
    city character varying,
    status boolean,
    country character varying DEFAULT 'India'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: permissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.permissions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code character varying NOT NULL,
    label character varying NOT NULL,
    rules jsonb[] DEFAULT '{}'::jsonb[] NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.roles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying NOT NULL,
    description character varying,
    permission_ids uuid[] DEFAULT '{}'::uuid[] NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: sponsors; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sponsors (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    championship_id uuid NOT NULL,
    name character varying NOT NULL,
    logo_url text,
    tier character varying DEFAULT 'community'::character varying NOT NULL,
    website_url text,
    display_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT sponsors_tier_check CHECK (((tier)::text = ANY ((ARRAY['title'::character varying, 'gold'::character varying, 'silver'::character varying, 'community'::character varying])::text[])))
);


--
-- Name: sports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sports (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying NOT NULL,
    icon character varying,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: standings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.standings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    championship_id uuid NOT NULL,
    scope_type character varying NOT NULL,
    scope_id uuid,
    organization_id uuid NOT NULL,
    played integer DEFAULT 0 NOT NULL,
    won integer DEFAULT 0 NOT NULL,
    drawn integer DEFAULT 0 NOT NULL,
    lost integer DEFAULT 0 NOT NULL,
    points integer DEFAULT 0 NOT NULL,
    detail jsonb DEFAULT '{}'::jsonb NOT NULL,
    rank integer,
    computed_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: standings_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.standings_rules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    championship_id uuid NOT NULL,
    scope_type character varying NOT NULL,
    scope_id uuid,
    config jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: team_entries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.team_entries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    team_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    championship_id uuid NOT NULL,
    championship_organization_id uuid NOT NULL,
    tournament_discipline_id uuid,
    status character varying DEFAULT 'forming'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: team_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.team_members (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    team_id uuid NOT NULL,
    user_id uuid NOT NULL,
    role character varying DEFAULT 'player'::character varying NOT NULL,
    jersey_number smallint,
    is_active boolean DEFAULT true NOT NULL,
    joined_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT team_members_role_check CHECK (((role)::text = ANY ((ARRAY['captain'::character varying, 'vice_captain'::character varying, 'player'::character varying, 'substitute'::character varying])::text[])))
);


--
-- Name: teams; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.teams (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    sport_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    name character varying NOT NULL,
    status character varying DEFAULT 'forming'::character varying NOT NULL,
    invite_token character varying,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT teams_status_check CHECK (((status)::text = ANY ((ARRAY['forming'::character varying, 'submitted'::character varying, 'approved'::character varying, 'roster_locked'::character varying])::text[])))
);


--
-- Name: tournament_disciplines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tournament_disciplines (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tournament_sport_id uuid NOT NULL,
    discipline_id uuid,
    format_id uuid,
    format_config jsonb DEFAULT '{}'::jsonb NOT NULL,
    venue_id uuid,
    rulebook_url text,
    entry_type character varying,
    squad_min smallint,
    squad_max smallint,
    status character varying DEFAULT 'upcoming'::character varying NOT NULL,
    display_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT tournament_disciplines_status_check CHECK (((status)::text = ANY ((ARRAY['upcoming'::character varying, 'ongoing'::character varying, 'completed'::character varying])::text[])))
);


--
-- Name: tournament_formats; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tournament_formats (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying NOT NULL,
    description character varying,
    config jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: tournament_sports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tournament_sports (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tournament_id uuid NOT NULL,
    sport_id uuid NOT NULL,
    format_id uuid NOT NULL,
    format_config jsonb DEFAULT '{}'::jsonb NOT NULL,
    display_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: tournaments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tournaments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    championship_id uuid NOT NULL,
    name character varying NOT NULL,
    description text,
    status character varying DEFAULT 'draft'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT tournaments_status_check CHECK (((status)::text = ANY ((ARRAY['draft'::character varying, 'active'::character varying, 'completed'::character varying, 'cancelled'::character varying])::text[])))
);


--
-- Name: user_championship_roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_championship_roles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    championship_id uuid NOT NULL,
    role_id uuid NOT NULL,
    assigned_by uuid,
    assigned_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: user_invitations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_invitations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    mobile character varying NOT NULL,
    target_type character varying NOT NULL,
    target_id uuid NOT NULL,
    role character varying,
    invited_by uuid NOT NULL,
    status character varying DEFAULT 'pending'::character varying NOT NULL,
    accepted_user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    responded_at timestamp with time zone,
    CONSTRAINT user_invitations_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'accepted'::character varying, 'cancelled'::character varying])::text[]))),
    CONSTRAINT user_invitations_target_type_check CHECK (((target_type)::text = ANY ((ARRAY['org_member'::character varying, 'championship_organiser'::character varying, 'championship_official'::character varying])::text[])))
);


--
-- Name: TABLE user_invitations; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.user_invitations IS 'Invite a person by mobile to an org-member / co-organiser / official role; auto-applied when they sign in with that number.';


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying NOT NULL,
    email character varying NOT NULL,
    phone character varying,
    avatar_url text,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    password_hash text,
    is_super_admin boolean DEFAULT false NOT NULL,
    organization_id uuid,
    account_type character varying DEFAULT 'participant'::character varying,
    must_change_password boolean DEFAULT false NOT NULL
);


--
-- Name: venue_grounds; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.venue_grounds (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    venue_id uuid NOT NULL,
    name character varying NOT NULL,
    ground_type character varying,
    capacity integer,
    display_order integer DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT venue_grounds_ground_type_check CHECK (((ground_type)::text = ANY ((ARRAY['court'::character varying, 'field'::character varying, 'pool'::character varying, 'track'::character varying, 'ring'::character varying, 'table'::character varying])::text[])))
);


--
-- Name: venues; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.venues (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    championship_id uuid NOT NULL,
    name character varying NOT NULL,
    address text,
    city character varying,
    country character varying DEFAULT 'India'::character varying NOT NULL,
    latitude numeric,
    longitude numeric,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Data for Name: championship_invitations; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: championship_officials; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: championship_organizations; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: championships; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: demo_requests; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: disciplines; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: feedback; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: fixture_awards; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: fixture_events; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: fixtures; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: notification_reactions; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: notification_reads; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: notifications; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: organization_members; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: organizations; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: permissions; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: roles; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: sponsors; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: sports; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: standings; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: standings_rules; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: team_entries; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: team_members; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: teams; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: tournament_disciplines; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: tournament_formats; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: tournament_sports; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: tournaments; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: user_championship_roles; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: user_invitations; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: users; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: venue_grounds; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: venues; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Name: championship_invitations championship_invitations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.championship_invitations
    ADD CONSTRAINT championship_invitations_pkey PRIMARY KEY (id);


--
-- Name: demo_requests demo_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.demo_requests
    ADD CONSTRAINT demo_requests_pkey PRIMARY KEY (id);


--
-- Name: disciplines disciplines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.disciplines
    ADD CONSTRAINT disciplines_pkey PRIMARY KEY (id);


--
-- Name: championship_organizations event_institutions_event_id_institution_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.championship_organizations
    ADD CONSTRAINT event_institutions_event_id_institution_id_key UNIQUE (championship_id, organization_id);


--
-- Name: championship_organizations event_institutions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.championship_organizations
    ADD CONSTRAINT event_institutions_pkey PRIMARY KEY (id);


--
-- Name: championship_officials event_officials_event_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.championship_officials
    ADD CONSTRAINT event_officials_event_id_user_id_key UNIQUE (championship_id, user_id);


--
-- Name: championship_officials event_officials_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.championship_officials
    ADD CONSTRAINT event_officials_pkey PRIMARY KEY (id);


--
-- Name: championships events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.championships
    ADD CONSTRAINT events_pkey PRIMARY KEY (id);


--
-- Name: championships events_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.championships
    ADD CONSTRAINT events_slug_key UNIQUE (slug);


--
-- Name: feedback feedback_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.feedback
    ADD CONSTRAINT feedback_pkey PRIMARY KEY (id);


--
-- Name: fixture_awards fixture_awards_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fixture_awards
    ADD CONSTRAINT fixture_awards_pkey PRIMARY KEY (id);


--
-- Name: fixture_events fixture_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fixture_events
    ADD CONSTRAINT fixture_events_pkey PRIMARY KEY (id);


--
-- Name: fixtures fixtures_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fixtures
    ADD CONSTRAINT fixtures_pkey PRIMARY KEY (id);


--
-- Name: organizations institutions_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organizations
    ADD CONSTRAINT institutions_code_key UNIQUE (code);


--
-- Name: organizations institutions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organizations
    ADD CONSTRAINT institutions_pkey PRIMARY KEY (id);


--
-- Name: notification_reactions notification_reactions_notification_id_user_id_reaction_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_reactions
    ADD CONSTRAINT notification_reactions_notification_id_user_id_reaction_key UNIQUE (notification_id, user_id, reaction);


--
-- Name: notification_reactions notification_reactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_reactions
    ADD CONSTRAINT notification_reactions_pkey PRIMARY KEY (id);


--
-- Name: notification_reads notification_reads_notification_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_reads
    ADD CONSTRAINT notification_reads_notification_id_user_id_key UNIQUE (notification_id, user_id);


--
-- Name: notification_reads notification_reads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_reads
    ADD CONSTRAINT notification_reads_pkey PRIMARY KEY (id);


--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);


--
-- Name: organization_members organization_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_members
    ADD CONSTRAINT organization_members_pkey PRIMARY KEY (id);


--
-- Name: organization_members organization_members_user_id_organization_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_members
    ADD CONSTRAINT organization_members_user_id_organization_id_key UNIQUE (user_id, organization_id);


--
-- Name: permissions permissions_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.permissions
    ADD CONSTRAINT permissions_code_key UNIQUE (code);


--
-- Name: permissions permissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.permissions
    ADD CONSTRAINT permissions_pkey PRIMARY KEY (id);


--
-- Name: roles roles_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_name_key UNIQUE (name);


--
-- Name: roles roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_pkey PRIMARY KEY (id);


--
-- Name: sponsors sponsors_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sponsors
    ADD CONSTRAINT sponsors_pkey PRIMARY KEY (id);


--
-- Name: sports sports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sports
    ADD CONSTRAINT sports_pkey PRIMARY KEY (id);


--
-- Name: standings standings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.standings
    ADD CONSTRAINT standings_pkey PRIMARY KEY (id);


--
-- Name: standings_rules standings_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.standings_rules
    ADD CONSTRAINT standings_rules_pkey PRIMARY KEY (id);


--
-- Name: team_entries team_entries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_entries
    ADD CONSTRAINT team_entries_pkey PRIMARY KEY (id);


--
-- Name: team_members team_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_members
    ADD CONSTRAINT team_members_pkey PRIMARY KEY (id);


--
-- Name: team_members team_members_team_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_members
    ADD CONSTRAINT team_members_team_id_user_id_key UNIQUE (team_id, user_id);


--
-- Name: teams teams_invite_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teams
    ADD CONSTRAINT teams_invite_token_key UNIQUE (invite_token);


--
-- Name: teams teams_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teams
    ADD CONSTRAINT teams_pkey PRIMARY KEY (id);


--
-- Name: tournament_disciplines tournament_disciplines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tournament_disciplines
    ADD CONSTRAINT tournament_disciplines_pkey PRIMARY KEY (id);


--
-- Name: tournament_disciplines tournament_disciplines_tournament_sport_id_discipline_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tournament_disciplines
    ADD CONSTRAINT tournament_disciplines_tournament_sport_id_discipline_id_key UNIQUE (tournament_sport_id, discipline_id);


--
-- Name: tournament_formats tournament_formats_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tournament_formats
    ADD CONSTRAINT tournament_formats_name_key UNIQUE (name);


--
-- Name: tournament_formats tournament_formats_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tournament_formats
    ADD CONSTRAINT tournament_formats_pkey PRIMARY KEY (id);


--
-- Name: tournament_sports tournament_sports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tournament_sports
    ADD CONSTRAINT tournament_sports_pkey PRIMARY KEY (id);


--
-- Name: tournament_sports tournament_sports_tournament_id_sport_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tournament_sports
    ADD CONSTRAINT tournament_sports_tournament_id_sport_id_key UNIQUE (tournament_id, sport_id);


--
-- Name: tournaments tournaments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tournaments
    ADD CONSTRAINT tournaments_pkey PRIMARY KEY (id);


--
-- Name: user_championship_roles user_event_roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_championship_roles
    ADD CONSTRAINT user_event_roles_pkey PRIMARY KEY (id);


--
-- Name: user_championship_roles user_event_roles_user_id_event_id_role_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_championship_roles
    ADD CONSTRAINT user_event_roles_user_id_event_id_role_id_key UNIQUE (user_id, championship_id, role_id);


--
-- Name: user_invitations user_invitations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_invitations
    ADD CONSTRAINT user_invitations_pkey PRIMARY KEY (id);


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: venue_grounds venue_grounds_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.venue_grounds
    ADD CONSTRAINT venue_grounds_pkey PRIMARY KEY (id);


--
-- Name: venues venues_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.venues
    ADD CONSTRAINT venues_pkey PRIMARY KEY (id);


--
-- Name: idx_championship_invitations_championship; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_championship_invitations_championship ON public.championship_invitations USING btree (championship_id);


--
-- Name: idx_championship_invitations_organization; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_championship_invitations_organization ON public.championship_invitations USING btree (organization_id);


--
-- Name: idx_demo_requests_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_demo_requests_created ON public.demo_requests USING btree (created_at DESC);


--
-- Name: idx_demo_requests_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_demo_requests_status ON public.demo_requests USING btree (status);


--
-- Name: idx_disciplines_sport_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_disciplines_sport_id ON public.disciplines USING btree (sport_id);


--
-- Name: idx_event_institutions_applied_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_event_institutions_applied_by ON public.championship_organizations USING btree (applied_by);


--
-- Name: idx_event_institutions_event_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_event_institutions_event_id ON public.championship_organizations USING btree (championship_id);


--
-- Name: idx_event_institutions_event_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_event_institutions_event_status ON public.championship_organizations USING btree (championship_id, status);


--
-- Name: idx_event_institutions_institution_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_event_institutions_institution_id ON public.championship_organizations USING btree (organization_id);


--
-- Name: idx_event_institutions_reviewed_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_event_institutions_reviewed_by ON public.championship_organizations USING btree (reviewed_by);


--
-- Name: idx_event_officials_event_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_event_officials_event_active ON public.championship_officials USING btree (championship_id) WHERE is_active;


--
-- Name: idx_event_officials_event_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_event_officials_event_id ON public.championship_officials USING btree (championship_id);


--
-- Name: idx_event_officials_user_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_event_officials_user_active ON public.championship_officials USING btree (user_id) WHERE is_active;


--
-- Name: idx_event_officials_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_event_officials_user_id ON public.championship_officials USING btree (user_id);


--
-- Name: idx_feedback_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_feedback_created ON public.feedback USING btree (created_at DESC);


--
-- Name: idx_feedback_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_feedback_status ON public.feedback USING btree (status);


--
-- Name: idx_fixture_awards_fixture; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fixture_awards_fixture ON public.fixture_awards USING btree (fixture_id);


--
-- Name: idx_fixture_awards_recipient; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fixture_awards_recipient ON public.fixture_awards USING btree (recipient_user_id);


--
-- Name: idx_fixture_events_fixture; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fixture_events_fixture ON public.fixture_events USING btree (fixture_id);


--
-- Name: idx_fixture_events_key; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fixture_events_key ON public.fixture_events USING btree (event_key);


--
-- Name: idx_fixture_events_player; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fixture_events_player ON public.fixture_events USING btree (player_user_id);


--
-- Name: idx_fixtures_away_team_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fixtures_away_team_id ON public.fixtures USING btree (away_team_id);


--
-- Name: idx_fixtures_completed_by_draw; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fixtures_completed_by_draw ON public.fixtures USING btree (tournament_discipline_id) WHERE ((status)::text = 'completed'::text);


--
-- Name: idx_fixtures_draw_ordering; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fixtures_draw_ordering ON public.fixtures USING btree (tournament_discipline_id, pool_number, bracket_position, created_at);


--
-- Name: idx_fixtures_home_team_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fixtures_home_team_id ON public.fixtures USING btree (home_team_id);


--
-- Name: idx_fixtures_official_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fixtures_official_id ON public.fixtures USING btree (official_id);


--
-- Name: idx_fixtures_official_scheduled; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fixtures_official_scheduled ON public.fixtures USING btree (official_id, scheduled_at);


--
-- Name: idx_fixtures_tournament_discipline_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fixtures_tournament_discipline_id ON public.fixtures USING btree (tournament_discipline_id);


--
-- Name: idx_fixtures_venue_ground_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fixtures_venue_ground_id ON public.fixtures USING btree (venue_ground_id);


--
-- Name: idx_fixtures_winner_team_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fixtures_winner_team_id ON public.fixtures USING btree (winner_team_id);


--
-- Name: idx_notification_reactions_notification_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notification_reactions_notification_id ON public.notification_reactions USING btree (notification_id);


--
-- Name: idx_notification_reads_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notification_reads_user ON public.notification_reads USING btree (user_id);


--
-- Name: idx_notifications_event_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_event_created ON public.notifications USING btree (championship_id, created_at DESC);


--
-- Name: idx_notifications_event_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_event_id ON public.notifications USING btree (championship_id);


--
-- Name: idx_notifications_organization; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_organization ON public.notifications USING btree (organization_id);


--
-- Name: idx_notifications_target_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_target_user ON public.notifications USING btree (target_user_id);


--
-- Name: idx_organization_members_org_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_organization_members_org_status ON public.organization_members USING btree (organization_id, status);


--
-- Name: idx_organization_members_organization_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_organization_members_organization_id ON public.organization_members USING btree (organization_id);


--
-- Name: idx_organization_members_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_organization_members_user_id ON public.organization_members USING btree (user_id);


--
-- Name: idx_sponsors_event_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sponsors_event_id ON public.sponsors USING btree (championship_id);


--
-- Name: idx_standings_championship; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_standings_championship ON public.standings USING btree (championship_id);


--
-- Name: idx_standings_rules_championship; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_standings_rules_championship ON public.standings_rules USING btree (championship_id);


--
-- Name: idx_standings_scope; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_standings_scope ON public.standings USING btree (championship_id, scope_type, scope_id);


--
-- Name: idx_team_entries_championship; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_team_entries_championship ON public.team_entries USING btree (championship_id);


--
-- Name: idx_team_entries_discipline; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_team_entries_discipline ON public.team_entries USING btree (tournament_discipline_id);


--
-- Name: idx_team_entries_team; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_team_entries_team ON public.team_entries USING btree (team_id);


--
-- Name: idx_team_members_team_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_team_members_team_active ON public.team_members USING btree (team_id) WHERE is_active;


--
-- Name: idx_team_members_team_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_team_members_team_id ON public.team_members USING btree (team_id);


--
-- Name: idx_team_members_user_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_team_members_user_active ON public.team_members USING btree (user_id) WHERE is_active;


--
-- Name: idx_team_members_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_team_members_user_id ON public.team_members USING btree (user_id);


--
-- Name: idx_teams_institution_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_teams_institution_id ON public.teams USING btree (organization_id);


--
-- Name: idx_teams_sport_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_teams_sport_id ON public.teams USING btree (sport_id);


--
-- Name: idx_tournament_disciplines_discipline_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tournament_disciplines_discipline_id ON public.tournament_disciplines USING btree (discipline_id);


--
-- Name: idx_tournament_disciplines_format_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tournament_disciplines_format_id ON public.tournament_disciplines USING btree (format_id);


--
-- Name: idx_tournament_disciplines_tournament_sport_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tournament_disciplines_tournament_sport_id ON public.tournament_disciplines USING btree (tournament_sport_id);


--
-- Name: idx_tournament_disciplines_venue_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tournament_disciplines_venue_id ON public.tournament_disciplines USING btree (venue_id);


--
-- Name: idx_tournament_sports_format_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tournament_sports_format_id ON public.tournament_sports USING btree (format_id);


--
-- Name: idx_tournament_sports_sport_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tournament_sports_sport_id ON public.tournament_sports USING btree (sport_id);


--
-- Name: idx_tournament_sports_tournament_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tournament_sports_tournament_id ON public.tournament_sports USING btree (tournament_id);


--
-- Name: idx_tournaments_event_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tournaments_event_id ON public.tournaments USING btree (championship_id);


--
-- Name: idx_user_event_roles_assigned_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_event_roles_assigned_by ON public.user_championship_roles USING btree (assigned_by);


--
-- Name: idx_user_event_roles_event_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_event_roles_event_id ON public.user_championship_roles USING btree (championship_id);


--
-- Name: idx_user_event_roles_role_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_event_roles_role_id ON public.user_championship_roles USING btree (role_id);


--
-- Name: idx_user_event_roles_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_event_roles_user_id ON public.user_championship_roles USING btree (user_id);


--
-- Name: idx_user_event_roles_user_role; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_event_roles_user_role ON public.user_championship_roles USING btree (user_id, role_id);


--
-- Name: idx_user_invitations_mobile; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_invitations_mobile ON public.user_invitations USING btree (mobile, status);


--
-- Name: idx_user_invitations_target; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_invitations_target ON public.user_invitations USING btree (target_type, target_id);


--
-- Name: idx_users_institution_account_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_institution_account_type ON public.users USING btree (organization_id, account_type);


--
-- Name: idx_users_organization_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_organization_id ON public.users USING btree (organization_id);


--
-- Name: idx_venue_grounds_venue_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_venue_grounds_venue_id ON public.venue_grounds USING btree (venue_id);


--
-- Name: idx_venues_event_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_venues_event_id ON public.venues USING btree (championship_id);


--
-- Name: uq_standings_rules_scope; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_standings_rules_scope ON public.standings_rules USING btree (championship_id, scope_type, COALESCE(scope_id, '00000000-0000-0000-0000-000000000000'::uuid));


--
-- Name: uq_standings_scope_org; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_standings_scope_org ON public.standings USING btree (championship_id, scope_type, COALESCE(scope_id, '00000000-0000-0000-0000-000000000000'::uuid), organization_id);


--
-- Name: uq_team_entries_org_draw; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_team_entries_org_draw ON public.team_entries USING btree (championship_id, tournament_discipline_id, organization_id) WHERE (tournament_discipline_id IS NOT NULL);


--
-- Name: uq_team_entries_team_championship; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_team_entries_team_championship ON public.team_entries USING btree (team_id, championship_id);


--
-- Name: users_phone_last10_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX users_phone_last10_key ON public.users USING btree ("right"(regexp_replace((COALESCE(phone, ''::character varying))::text, '[^0-9]'::text, ''::text, 'g'::text), 10)) WHERE (phone IS NOT NULL);


--
-- Name: championships trg_championships_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_championships_updated_at BEFORE UPDATE ON public.championships FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: teams trg_teams_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_teams_updated_at BEFORE UPDATE ON public.teams FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: tournaments trg_tournaments_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_tournaments_updated_at BEFORE UPDATE ON public.tournaments FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: users trg_users_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: venues trg_venues_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_venues_updated_at BEFORE UPDATE ON public.venues FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: championship_invitations championship_invitations_accepted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.championship_invitations
    ADD CONSTRAINT championship_invitations_accepted_by_fkey FOREIGN KEY (accepted_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: championship_invitations championship_invitations_championship_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.championship_invitations
    ADD CONSTRAINT championship_invitations_championship_id_fkey FOREIGN KEY (championship_id) REFERENCES public.championships(id) ON DELETE CASCADE;


--
-- Name: championship_invitations championship_invitations_invited_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.championship_invitations
    ADD CONSTRAINT championship_invitations_invited_by_fkey FOREIGN KEY (invited_by) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: championship_invitations championship_invitations_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.championship_invitations
    ADD CONSTRAINT championship_invitations_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE SET NULL;


--
-- Name: demo_requests demo_requests_handled_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.demo_requests
    ADD CONSTRAINT demo_requests_handled_by_fkey FOREIGN KEY (handled_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: disciplines disciplines_sport_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.disciplines
    ADD CONSTRAINT disciplines_sport_id_fkey FOREIGN KEY (sport_id) REFERENCES public.sports(id);


--
-- Name: championship_organizations event_institutions_applied_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.championship_organizations
    ADD CONSTRAINT event_institutions_applied_by_fkey FOREIGN KEY (applied_by) REFERENCES public.users(id);


--
-- Name: championship_organizations event_institutions_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.championship_organizations
    ADD CONSTRAINT event_institutions_event_id_fkey FOREIGN KEY (championship_id) REFERENCES public.championships(id);


--
-- Name: championship_organizations event_institutions_institution_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.championship_organizations
    ADD CONSTRAINT event_institutions_institution_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: championship_organizations event_institutions_reviewed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.championship_organizations
    ADD CONSTRAINT event_institutions_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES public.users(id);


--
-- Name: championship_officials event_officials_assigned_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.championship_officials
    ADD CONSTRAINT event_officials_assigned_by_fkey FOREIGN KEY (assigned_by) REFERENCES public.users(id);


--
-- Name: championship_officials event_officials_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.championship_officials
    ADD CONSTRAINT event_officials_event_id_fkey FOREIGN KEY (championship_id) REFERENCES public.championships(id) ON DELETE CASCADE;


--
-- Name: championship_officials event_officials_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.championship_officials
    ADD CONSTRAINT event_officials_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: feedback feedback_championship_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.feedback
    ADD CONSTRAINT feedback_championship_id_fkey FOREIGN KEY (championship_id) REFERENCES public.championships(id) ON DELETE SET NULL;


--
-- Name: feedback feedback_handled_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.feedback
    ADD CONSTRAINT feedback_handled_by_fkey FOREIGN KEY (handled_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: feedback feedback_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.feedback
    ADD CONSTRAINT feedback_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: fixture_awards fixture_awards_fixture_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fixture_awards
    ADD CONSTRAINT fixture_awards_fixture_id_fkey FOREIGN KEY (fixture_id) REFERENCES public.fixtures(id) ON DELETE CASCADE;


--
-- Name: fixture_awards fixture_awards_recipient_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fixture_awards
    ADD CONSTRAINT fixture_awards_recipient_user_id_fkey FOREIGN KEY (recipient_user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: fixture_events fixture_events_fixture_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fixture_events
    ADD CONSTRAINT fixture_events_fixture_id_fkey FOREIGN KEY (fixture_id) REFERENCES public.fixtures(id) ON DELETE CASCADE;


--
-- Name: fixture_events fixture_events_player_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fixture_events
    ADD CONSTRAINT fixture_events_player_user_id_fkey FOREIGN KEY (player_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: fixtures fixtures_away_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fixtures
    ADD CONSTRAINT fixtures_away_team_id_fkey FOREIGN KEY (away_team_id) REFERENCES public.teams(id);


--
-- Name: fixtures fixtures_home_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fixtures
    ADD CONSTRAINT fixtures_home_team_id_fkey FOREIGN KEY (home_team_id) REFERENCES public.teams(id);


--
-- Name: fixtures fixtures_official_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fixtures
    ADD CONSTRAINT fixtures_official_id_fkey FOREIGN KEY (official_id) REFERENCES public.users(id);


--
-- Name: fixtures fixtures_tournament_discipline_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fixtures
    ADD CONSTRAINT fixtures_tournament_discipline_id_fkey FOREIGN KEY (tournament_discipline_id) REFERENCES public.tournament_disciplines(id);


--
-- Name: fixtures fixtures_venue_ground_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fixtures
    ADD CONSTRAINT fixtures_venue_ground_id_fkey FOREIGN KEY (venue_ground_id) REFERENCES public.venue_grounds(id);


--
-- Name: fixtures fixtures_winner_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fixtures
    ADD CONSTRAINT fixtures_winner_team_id_fkey FOREIGN KEY (winner_team_id) REFERENCES public.teams(id);


--
-- Name: notification_reactions notification_reactions_notification_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_reactions
    ADD CONSTRAINT notification_reactions_notification_id_fkey FOREIGN KEY (notification_id) REFERENCES public.notifications(id) ON DELETE CASCADE;


--
-- Name: notification_reactions notification_reactions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_reactions
    ADD CONSTRAINT notification_reactions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: notification_reads notification_reads_notification_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_reads
    ADD CONSTRAINT notification_reads_notification_id_fkey FOREIGN KEY (notification_id) REFERENCES public.notifications(id) ON DELETE CASCADE;


--
-- Name: notification_reads notification_reads_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_reads
    ADD CONSTRAINT notification_reads_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: notifications notifications_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_event_id_fkey FOREIGN KEY (championship_id) REFERENCES public.championships(id) ON DELETE CASCADE;


--
-- Name: notifications notifications_sender_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_sender_id_fkey FOREIGN KEY (sender_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: organization_members organization_members_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_members
    ADD CONSTRAINT organization_members_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: organization_members organization_members_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_members
    ADD CONSTRAINT organization_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: sponsors sponsors_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sponsors
    ADD CONSTRAINT sponsors_event_id_fkey FOREIGN KEY (championship_id) REFERENCES public.championships(id);


--
-- Name: standings standings_championship_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.standings
    ADD CONSTRAINT standings_championship_id_fkey FOREIGN KEY (championship_id) REFERENCES public.championships(id) ON DELETE CASCADE;


--
-- Name: standings standings_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.standings
    ADD CONSTRAINT standings_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: standings_rules standings_rules_championship_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.standings_rules
    ADD CONSTRAINT standings_rules_championship_id_fkey FOREIGN KEY (championship_id) REFERENCES public.championships(id) ON DELETE CASCADE;


--
-- Name: team_entries team_entries_championship_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_entries
    ADD CONSTRAINT team_entries_championship_id_fkey FOREIGN KEY (championship_id) REFERENCES public.championships(id);


--
-- Name: team_entries team_entries_championship_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_entries
    ADD CONSTRAINT team_entries_championship_organization_id_fkey FOREIGN KEY (championship_organization_id) REFERENCES public.championship_organizations(id);


--
-- Name: team_entries team_entries_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_entries
    ADD CONSTRAINT team_entries_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: team_entries team_entries_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_entries
    ADD CONSTRAINT team_entries_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE CASCADE;


--
-- Name: team_entries team_entries_tournament_discipline_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_entries
    ADD CONSTRAINT team_entries_tournament_discipline_id_fkey FOREIGN KEY (tournament_discipline_id) REFERENCES public.tournament_disciplines(id);


--
-- Name: team_members team_members_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_members
    ADD CONSTRAINT team_members_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(id);


--
-- Name: team_members team_members_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_members
    ADD CONSTRAINT team_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: teams teams_institution_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teams
    ADD CONSTRAINT teams_institution_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: teams teams_sport_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teams
    ADD CONSTRAINT teams_sport_id_fkey FOREIGN KEY (sport_id) REFERENCES public.sports(id);


--
-- Name: tournament_disciplines tournament_disciplines_discipline_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tournament_disciplines
    ADD CONSTRAINT tournament_disciplines_discipline_id_fkey FOREIGN KEY (discipline_id) REFERENCES public.disciplines(id);


--
-- Name: tournament_disciplines tournament_disciplines_format_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tournament_disciplines
    ADD CONSTRAINT tournament_disciplines_format_id_fkey FOREIGN KEY (format_id) REFERENCES public.tournament_formats(id);


--
-- Name: tournament_disciplines tournament_disciplines_tournament_sport_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tournament_disciplines
    ADD CONSTRAINT tournament_disciplines_tournament_sport_id_fkey FOREIGN KEY (tournament_sport_id) REFERENCES public.tournament_sports(id);


--
-- Name: tournament_disciplines tournament_disciplines_venue_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tournament_disciplines
    ADD CONSTRAINT tournament_disciplines_venue_id_fkey FOREIGN KEY (venue_id) REFERENCES public.venues(id);


--
-- Name: tournament_sports tournament_sports_format_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tournament_sports
    ADD CONSTRAINT tournament_sports_format_id_fkey FOREIGN KEY (format_id) REFERENCES public.tournament_formats(id);


--
-- Name: tournament_sports tournament_sports_sport_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tournament_sports
    ADD CONSTRAINT tournament_sports_sport_id_fkey FOREIGN KEY (sport_id) REFERENCES public.sports(id);


--
-- Name: tournament_sports tournament_sports_tournament_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tournament_sports
    ADD CONSTRAINT tournament_sports_tournament_id_fkey FOREIGN KEY (tournament_id) REFERENCES public.tournaments(id);


--
-- Name: tournaments tournaments_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tournaments
    ADD CONSTRAINT tournaments_event_id_fkey FOREIGN KEY (championship_id) REFERENCES public.championships(id);


--
-- Name: user_championship_roles user_event_roles_assigned_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_championship_roles
    ADD CONSTRAINT user_event_roles_assigned_by_fkey FOREIGN KEY (assigned_by) REFERENCES public.users(id);


--
-- Name: user_championship_roles user_event_roles_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_championship_roles
    ADD CONSTRAINT user_event_roles_event_id_fkey FOREIGN KEY (championship_id) REFERENCES public.championships(id);


--
-- Name: user_championship_roles user_event_roles_role_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_championship_roles
    ADD CONSTRAINT user_event_roles_role_id_fkey FOREIGN KEY (role_id) REFERENCES public.roles(id);


--
-- Name: user_championship_roles user_event_roles_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_championship_roles
    ADD CONSTRAINT user_event_roles_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: user_invitations user_invitations_accepted_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_invitations
    ADD CONSTRAINT user_invitations_accepted_user_id_fkey FOREIGN KEY (accepted_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: user_invitations user_invitations_invited_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_invitations
    ADD CONSTRAINT user_invitations_invited_by_fkey FOREIGN KEY (invited_by) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: users users_institution_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_institution_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: venue_grounds venue_grounds_venue_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.venue_grounds
    ADD CONSTRAINT venue_grounds_venue_id_fkey FOREIGN KEY (venue_id) REFERENCES public.venues(id);


--
-- Name: venues venues_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.venues
    ADD CONSTRAINT venues_event_id_fkey FOREIGN KEY (championship_id) REFERENCES public.championships(id);


--
-- Name: championship_invitations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.championship_invitations ENABLE ROW LEVEL SECURITY;

--
-- Name: championship_officials; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.championship_officials ENABLE ROW LEVEL SECURITY;

--
-- Name: championship_organizations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.championship_organizations ENABLE ROW LEVEL SECURITY;

--
-- Name: championships; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.championships ENABLE ROW LEVEL SECURITY;

--
-- Name: demo_requests; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.demo_requests ENABLE ROW LEVEL SECURITY;

--
-- Name: disciplines; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.disciplines ENABLE ROW LEVEL SECURITY;

--
-- Name: feedback; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.feedback ENABLE ROW LEVEL SECURITY;

--
-- Name: fixture_awards; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.fixture_awards ENABLE ROW LEVEL SECURITY;

--
-- Name: fixture_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.fixture_events ENABLE ROW LEVEL SECURITY;

--
-- Name: fixtures; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.fixtures ENABLE ROW LEVEL SECURITY;

--
-- Name: notification_reactions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.notification_reactions ENABLE ROW LEVEL SECURITY;

--
-- Name: notification_reads; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.notification_reads ENABLE ROW LEVEL SECURITY;

--
-- Name: notifications; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

--
-- Name: organization_members; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.organization_members ENABLE ROW LEVEL SECURITY;

--
-- Name: organizations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;

--
-- Name: permissions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.permissions ENABLE ROW LEVEL SECURITY;

--
-- Name: roles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;

--
-- Name: sponsors; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sponsors ENABLE ROW LEVEL SECURITY;

--
-- Name: sports; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sports ENABLE ROW LEVEL SECURITY;

--
-- Name: standings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.standings ENABLE ROW LEVEL SECURITY;

--
-- Name: standings_rules; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.standings_rules ENABLE ROW LEVEL SECURITY;

--
-- Name: team_entries; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.team_entries ENABLE ROW LEVEL SECURITY;

--
-- Name: team_members; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.team_members ENABLE ROW LEVEL SECURITY;

--
-- Name: teams; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;

--
-- Name: tournament_disciplines; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.tournament_disciplines ENABLE ROW LEVEL SECURITY;

--
-- Name: tournament_formats; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.tournament_formats ENABLE ROW LEVEL SECURITY;

--
-- Name: tournament_sports; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.tournament_sports ENABLE ROW LEVEL SECURITY;

--
-- Name: tournaments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.tournaments ENABLE ROW LEVEL SECURITY;

--
-- Name: user_championship_roles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_championship_roles ENABLE ROW LEVEL SECURITY;

--
-- Name: user_invitations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_invitations ENABLE ROW LEVEL SECURITY;

--
-- Name: users; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

--
-- Name: venue_grounds; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.venue_grounds ENABLE ROW LEVEL SECURITY;

--
-- Name: venues; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.venues ENABLE ROW LEVEL SECURITY;

--
-- PostgreSQL database dump complete
--

\unrestrict fHE5dr2RcjWqNdoYt8hlOPwNqCi8AM3Wbuj4dGfUKiG0kvjpkBdGduoDVzPtCGv


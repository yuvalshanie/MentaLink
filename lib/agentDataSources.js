// Central source mapping for every agent-facing external data source.
// Pinecone target strings intentionally match stored metadata exactly.

export const MODULE_ANALYZER = "UserRequestAnalyzer";
export const MODULE_MATCHMAKER = "MatchmakerAgent";
export const MODULE_GUARDIAN = "EthicalGuardianAgent";

export const AGENT_DATA_SOURCES = Object.freeze({
  [MODULE_MATCHMAKER]: Object.freeze({
    pineconeTarget: "Matchmaker Agent",
    defaultSupabaseTable: "therapist_data",
  }),
  [MODULE_GUARDIAN]: Object.freeze({
    pineconeTarget: "Ethical Guardian Agent",
    defaultSupabaseTable: "mental_health_diagnosis_treatment",
  }),
});

export function getAgentDataSource(agentModule) {
  const source = AGENT_DATA_SOURCES[agentModule];
  if (!source) {
    throw new Error(`No external data-source mapping exists for ${agentModule}.`);
  }
  return source;
}

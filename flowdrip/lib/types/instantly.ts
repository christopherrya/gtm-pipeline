export interface InstantlyScheduleTiming { from: string; to: string; }
export interface InstantlyScheduleDays { monday?: boolean; tuesday?: boolean; wednesday?: boolean; thursday?: boolean; friday?: boolean; saturday?: boolean; sunday?: boolean; }
export interface InstantlyScheduleEntry { name: string; timing: InstantlyScheduleTiming; days: InstantlyScheduleDays; timezone: string; }
export interface InstantlyCampaignSchedule { start_date?: string; end_date?: string; schedules: InstantlyScheduleEntry[]; }
export interface InstantlyEmailVariant { subject: string; body: string; disabled?: boolean; }
export interface InstantlyStep { type: "email"; delay: number; variants: InstantlyEmailVariant[]; }
export interface InstantlySequence { steps: InstantlyStep[]; }
export interface InstantlyCampaignCreate { name: string; campaign_schedule: InstantlyCampaignSchedule; sequences: [InstantlySequence]; }
export interface InstantlySubsequenceConditions { email_opened?: boolean; email_clicked?: boolean; email_bounced?: boolean; }
export interface InstantlySubsequenceCreate { parent_campaign: string; name: string; conditions: InstantlySubsequenceConditions; sequences: [InstantlySequence]; pre_delay: number; }
export interface InstantlyCampaignResponse { id: string; name: string; status: number; created_at: string; updated_at: string; }
export interface InstantlyListResponse { items: InstantlyCampaignResponse[]; total_count: number; next_cursor?: string; }
export interface ExtractedBranch { conditionNodeId: string; conditionType: string; branch: "yes" | "no"; name: string; conditions: InstantlySubsequenceConditions; steps: InstantlyStep[]; preDelay: number; }
export interface TransformationResult { campaign: InstantlyCampaignCreate; subsequences: Omit<InstantlySubsequenceCreate, "parent_campaign">[]; warnings: string[]; }
export interface FlowDripVariant { id: string; subject: string; body: string; }

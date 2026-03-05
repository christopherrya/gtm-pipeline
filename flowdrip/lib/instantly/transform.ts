import { Node, Edge } from "@xyflow/react";
import type { InstantlyCampaignCreate, InstantlyCampaignSchedule, InstantlyEmailVariant, InstantlyStep, InstantlySubsequenceConditions, ExtractedBranch, TransformationResult, FlowDripVariant } from "@/lib/types/instantly";

function getNextNodeId(nodeId: string, edges: Edge[], sourceHandle?: string): string | null {
  const edge = edges.find((e) => e.source === nodeId && (sourceHandle ? e.sourceHandle === sourceHandle : true));
  return edge?.target ?? null;
}

function convertToDays(duration: number, unit: string, warnings: string[]): number {
  switch (unit) {
    case "minutes":
      if (duration < 1440) warnings.push(`Delay of ${duration} minute(s) rounded up to 1 day for Instantly.`);
      return Math.max(1, Math.ceil(duration / 1440));
    case "hours":
      if (duration < 24) warnings.push(`Delay of ${duration} hour(s) rounded up to 1 day for Instantly.`);
      return Math.max(1, Math.ceil(duration / 24));
    case "days": return Math.max(1, duration);
    case "weeks": return duration * 7;
    default: return 1;
  }
}

function mapCondition(conditionType: string, isYes: boolean): InstantlySubsequenceConditions {
  switch (conditionType) {
    case "Email opened": return { email_opened: isYes };
    case "Email clicked": return { email_clicked: isYes };
    case "Email bounced": return { email_bounced: isYes };
    default: return { email_opened: isYes };
  }
}

function getVariantsForNode(node: Node): InstantlyEmailVariant[] {
  const data = node.data as Record<string, unknown>;
  const variants = data.variants as FlowDripVariant[] | undefined;
  const result: InstantlyEmailVariant[] = [{ subject: (data.subject as string) || "", body: (data.body as string) || "" }];
  if (variants && variants.length > 0) {
    for (const v of variants) result.push({ subject: v.subject, body: v.body });
  }
  return result;
}

function walkPath(startNodeId: string, nodesMap: Map<string, Node>, edges: Edge[], branches: ExtractedBranch[], warnings: string[], namePrefix: string): InstantlyStep[] {
  const steps: InstantlyStep[] = [];
  let currentNodeId: string | null = startNodeId;
  let pendingDelayDays = 0;
  const visited = new Set<string>();

  while (currentNodeId) {
    if (visited.has(currentNodeId)) { warnings.push("Cycle detected. Stopping."); break; }
    visited.add(currentNodeId);
    const node = nodesMap.get(currentNodeId);
    if (!node) break;

    switch (node.type) {
      case "trigger":
        currentNodeId = getNextNodeId(currentNodeId, edges);
        break;
      case "email": {
        steps.push({ type: "email", delay: steps.length === 0 ? 0 : pendingDelayDays, variants: getVariantsForNode(node) });
        pendingDelayDays = 0;
        currentNodeId = getNextNodeId(currentNodeId, edges);
        break;
      }
      case "delay": {
        const d = node.data as Record<string, unknown>;
        pendingDelayDays += convertToDays((d.duration as number) ?? 1, (d.unit as string) || "days", warnings);
        currentNodeId = getNextNodeId(currentNodeId, edges);
        break;
      }
      case "condition": {
        const d = node.data as Record<string, unknown>;
        const ct = (d.conditionType as string) || "Email opened";
        const yesTarget = getNextNodeId(currentNodeId, edges, "yes");
        if (yesTarget) {
          const yesNode = nodesMap.get(yesTarget);
          if (yesNode && yesNode.type !== "end") {
            const branchSteps = walkPath(yesTarget, nodesMap, edges, branches, warnings, `${namePrefix}${ct} > `);
            if (branchSteps.length > 0) {
              branches.push({ conditionNodeId: currentNodeId, conditionType: ct, branch: "yes", name: `${namePrefix}${ct} - Yes`, conditions: mapCondition(ct, true), steps: branchSteps, preDelay: pendingDelayDays || 1 });
            }
          }
        }
        pendingDelayDays = 0;
        currentNodeId = getNextNodeId(currentNodeId, edges, "no");
        break;
      }
      case "end": currentNodeId = null; break;
      default: currentNodeId = getNextNodeId(currentNodeId, edges);
    }
  }
  return steps;
}

export function transformGraphToInstantly(nodes: Node[], edges: Edge[], campaignName: string, schedule: InstantlyCampaignSchedule): TransformationResult {
  const warnings: string[] = [];
  const branches: ExtractedBranch[] = [];
  const nodesMap = new Map<string, Node>();
  for (const node of nodes) nodesMap.set(node.id, node);

  const triggerNode = nodes.find((n) => n.type === "trigger");
  if (!triggerNode) {
    return { campaign: { name: campaignName, campaign_schedule: schedule, sequences: [{ steps: [] }] }, subsequences: [], warnings: ["No trigger node found."] };
  }

  const mainSteps = walkPath(triggerNode.id, nodesMap, edges, branches, warnings, "");
  if (mainSteps.length === 0) warnings.push("No email steps in main path.");

  return {
    campaign: { name: campaignName, campaign_schedule: schedule, sequences: [{ steps: mainSteps }] },
    subsequences: branches.map((b) => ({ name: b.name, conditions: b.conditions, sequences: [{ steps: b.steps }] as [{ steps: InstantlyStep[] }], pre_delay: b.preDelay })),
    warnings,
  };
}

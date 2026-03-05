import { Node, Edge } from '@xyflow/react';

interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export function validateCampaign(nodes: Node[], edges: Edge[]): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (nodes.length === 0) {
    errors.push('Campaign is empty. Add at least one node.');
    return { valid: false, errors, warnings };
  }

  const triggerNodes = nodes.filter((n) => n.type === 'trigger');
  if (triggerNodes.length === 0) errors.push('Campaign must have exactly one Trigger node.');
  else if (triggerNodes.length > 1) errors.push('Campaign can only have one Trigger node.');

  const nonEndNodes = nodes.filter((n) => n.type !== 'end');
  for (const node of nonEndNodes) {
    if (!edges.some((e) => e.source === node.id)) {
      errors.push(`"${(node.data as Record<string, unknown>)?.label || node.type}" node has no outgoing connection.`);
    }
  }

  const nonTriggerNodes = nodes.filter((n) => n.type !== 'trigger');
  for (const node of nonTriggerNodes) {
    if (!edges.some((e) => e.target === node.id)) {
      warnings.push(`"${(node.data as Record<string, unknown>)?.label || node.type}" node is unreachable.`);
    }
  }

  if (!nodes.some((n) => n.type === 'end')) {
    warnings.push('No End node found. Consider adding one.');
  }

  const conditionNodes = nodes.filter((n) => n.type === 'condition');
  for (const node of conditionNodes) {
    const hasYes = edges.some((e) => e.source === node.id && e.sourceHandle === 'yes');
    const hasNo = edges.some((e) => e.source === node.id && e.sourceHandle === 'no');
    if (!hasYes || !hasNo) {
      warnings.push(`Condition "${(node.data as Record<string, unknown>)?.conditionType}" should have both Yes and No paths.`);
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

export function validateForInstantly(nodes: Node[], edges: Edge[]): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const emailNodes = nodes.filter((n) => n.type === "email");
  if (emailNodes.length === 0) errors.push("Instantly campaigns require at least one Email step.");

  for (const node of emailNodes) {
    const d = node.data as Record<string, unknown>;
    if (!d.subject || !(d.subject as string).trim()) errors.push(`Email "${d.label || node.id}" has no subject line.`);
    if (!d.body || !(d.body as string).trim()) errors.push(`Email "${d.label || node.id}" has no body content.`);
  }

  const delayNodes = nodes.filter((n) => n.type === "delay");
  for (const node of delayNodes) {
    const d = node.data as Record<string, unknown>;
    const unit = d.unit as string;
    const duration = d.duration as number;
    if (unit === "minutes" && duration < 1440) warnings.push(`Delay of ${duration} minutes will be rounded up to 1 day.`);
    if (unit === "hours" && duration < 24) warnings.push(`Delay of ${duration} hours will be rounded up to 1 day.`);
  }

  for (const node of nodes.filter((n) => n.type === "condition")) {
    const yesEdge = edges.find((e) => e.source === node.id && e.sourceHandle === "yes");
    if (yesEdge && nodes.find((n) => n.id === yesEdge.target)?.type === "end") {
      warnings.push(`Condition "${(node.data as Record<string, unknown>).conditionType}" Yes leads to End — empty subsequence.`);
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

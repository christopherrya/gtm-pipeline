import TriggerNode from '@/components/nodes/TriggerNode';
import EmailNode from '@/components/nodes/EmailNode';
import DelayNode from '@/components/nodes/DelayNode';
import ConditionNode from '@/components/nodes/ConditionNode';
import EndNode from '@/components/nodes/EndNode';
import { NodeTypes } from '@xyflow/react';

export const nodeTypes: NodeTypes = {
  trigger: TriggerNode,
  email: EmailNode,
  delay: DelayNode,
  condition: ConditionNode,
  end: EndNode,
};

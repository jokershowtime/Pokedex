import type { LearnedMove, LearningSource } from './types';
export const learningMethod = (method: LearnedMove['methods'][number], generation: number) => {
  if (method.id === 1) return method.level ? 'Lv.' + method.level + ' 升级' : '进化／回忆记录';
  if (method.id === 4 && method.machineNumber !== null) return (generation <= 6 && method.machineNumber > 100 ? 'HM' + String(method.machineNumber - 100).padStart(2, '0') : 'TM' + String(method.machineNumber).padStart(2, '0'));
  return method.name;
};
export function LearningNotice({ source, unknown = 0 }: { source: LearningSource; unknown?: number }) {
  return <div className={'dex-learning-notice ' + source.status} role="note">
    {source.status === 'missing' ? '当前版本缺少学习表，无法确认招式条件；空记录不代表不能学习。' : source.status === 'reference' ? '学习记录引用：' + source.version + '。所选版本缺少独立学习表，请结合实际游戏核对。' : '招式条件使用当前版本的学习记录。'}
    {unknown > 0 && <p>{unknown} 只符合其他条件的宝可梦缺少学习记录，未计入已确认匹配。</p>}
    <p>多招式匹配表示分别存在学习记录，尚未验证遗传、活动等来源能否组成同一套合法配招。</p>
  </div>;
}

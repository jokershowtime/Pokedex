const { ROLES } = require('./team-solver.cjs');
function playbook(members, c, names = {}, opponents = [], matchups = []) {
  const label = (kind, name) => names[kind]?.[name] || name;
  const find = trait => members.filter(member => member.traits.includes(trait));
  const list = values => values.map(value => value.name).join('、');
  const moves = (values, allowed) => values.map(value => value.name + '（' + value.moves.filter(move => allowed.includes(move)).map(move => label('moves', move)).join('／') + '）').join('、');
  const opening = [], rotation = [], pressure = [], cautions = [];
  const weather = [['rain', '雨天'], ['sun', '晴天'], ['sand', '沙暴'], ['snow', c.generation >= 9 ? '雪天' : '冰雹']];
  const starters = weather.filter(([id]) => find(id + '-start').length);
  for (const [id, title] of starters) {
    opening.push(title + '由 ' + list(find(id + '-start')) + ' 的对应特性或天气招式启动。' + (find(id + '-user').length ? '天气建立后，安排 ' + list(find(id + '-user')) + ' 发挥对应收益。' : '是否启动应结合本回合对手与后续成员决定。'));
  }
  if (starters.length > 1) cautions.push('存在多种天气启动配置，上场或使用天气招式时可能替换当前天气，请围绕当前进攻成员选择。');
  if (find('room').length) {
    opening.push('戏法空间由 ' + moves(find('room'), ['Trick Room']) + ' 启动；队内常态速度不超过 80 的成员为 ' + (list(members.filter(member => member.speed <= 80)) || '无') + '。');
    cautions.push('空间中同优先度通常由慢者先行动，留意剩余回合；常态速度表不变，对手先手条件按你选定的战况核对。');
  }
  if (find('tailwind').length) opening.push('顺风由 ' + moves(find('tailwind'), ['Tailwind']) + ' 提供；确认需要速度优势时再使用，后续换人也要留意有效回合。');
  if (find('room').length && find('tailwind').length) cautions.push('顺风与戏法空间会共同影响行动顺序，避免不考虑当前空间状态就直接叠加提速。');
  if (find('screens').length) opening.push('保护性场地由 ' + moves(find('screens'), ['Reflect', 'Light Screen', 'Aurora Veil']) + ' 提供，可用于争取后续行动机会。');
  if (members.some(member => member.moves.includes('Aurora Veil')) && !find('snow-start').length) cautions.push('极光幕需要相应天气，当前队伍未识别到雪天／冰雹启动配置，需要另外准备。');
  if (find('hazards').length) opening.push('可考虑由 ' + moves(find('hazards'), ['Stealth Rock', 'Spikes', 'Toxic Spikes', 'Sticky Web']) + ' 布置场地；指定首发前先检查对手是否适合让你争取这一回合。');
  if (!opening.length) opening.push('未识别到固定的天气、空间、顺风或场地启动流程，可根据对手选择合适的打点或轮转成员开场。');
  if (find('pivot').length) rotation.push('轮转手为 ' + moves(find('pivot'), ['U-turn', 'Volt Switch', 'Flip Turn', 'Parting Shot', 'Chilly Reception', 'Teleport']) + '；使用前核对属性免疫与承伤情况。');
  if (find('removal').length) rotation.push('清场相关配置为 ' + moves(find('removal'), ['Rapid Spin', 'Defog', 'Mortal Spin', 'Tidy Up']) + '，根据对方场地效果安排使用时机。');
  if (members.some(member => member.moves.includes('Defog') || member.moves.includes('Tidy Up')) && find('hazards').length) cautions.push('清除浓雾／大扫除可能影响自己布置的场地效果；清除浓雾的作用范围还会随世代变化，请结合当前规则安排。');
  if (find('recovery').length) rotation.push('回复相关成员为 ' + list(find('recovery')) + '，应预留回复回合，避免持续进攻后失去后续轮转空间。');
  if (members.some(member => member.moves.includes('Rest') && !member.moves.includes('Sleep Talk'))) cautions.push('有成员使用睡觉且未携带梦话，需要考虑睡眠期间的行动与换人。');
  if (members.some(member => member.moves.includes('Wish'))) rotation.push('祈愿属于延迟回复，可结合实际回合和换人安排接收成员。');
  if (find('setup').length) pressure.push('强化机会可交给 ' + moves(find('setup'), ['Swords Dance', 'Dragon Dance', 'Nasty Plot', 'Calm Mind', 'Quiver Dance', 'Shell Smash', 'Bulk Up', 'Iron Defense']) + '；先判断本回合能否承受干扰或攻击。');
  if (find('priority').length) pressure.push(list(find('priority')) + ' 携带先制攻击，可补充收尾手段；先制不能据此视为一定先动或一定击倒。');
  for (const opponent of opponents) {
    const row = matchups.find(value => opponent.targetId ? value.targetId === opponent.targetId : value.pokemonId === opponent.pokemonId);
    if (row?.attackers.length) pressure.push('针对 ' + opponent.name + ' 的本次参考配置，可检查 ' + row.attackers.map(member => member.name + '（' + member.moves.map(move => label('moves', move.name)).join('／') + '）').join('、') + ' 的克制打点。');
    if (opponent.set.selection.ability === 'Magic Bounce' && find('hazards').length) cautions.push(opponent.name + ' 的参考特性为魔法镜，布置场地前需要考虑反射。');
  }
  return { opening, rotation, pressure, cautions: [...new Set(cautions)],
    roles: ROLES.flatMap(role => find(role.id).length ? [{ label: role.label, members: find(role.id).map(value => value.name), minimum: Math.max(c.roleCounts?.[role.id] || 0, c.roles.includes(role.id) ? 1 : 0) }] : []) };
}
function playbookText(plan) {
  return [['开场与启动', plan.opening], ['轮转与续航', plan.rotation], ['进攻安排', plan.pressure], ['需要留意', plan.cautions]]
    .filter(([, rows]) => rows.length).map(([title, rows]) => title + '：\n' + rows.map(text => '· ' + text).join('\n')).join('\n');
}
module.exports = { playbook, playbookText };

// 测试环境：打开不变量检查，装载卡池加测试专用卡。
import { installDefaultPool } from '../src/cards';
import { setInvariantChecks } from '../src/engine';
import { TEST_CARDS } from './helpers/testCards';

setInvariantChecks(true);
installDefaultPool(TEST_CARDS);

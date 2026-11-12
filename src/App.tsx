import { useRoute } from './lib/router';
import { Create } from './screens/Create';
import { Home } from './screens/Home';
import { Lesson } from './screens/Lesson';
import { Parent } from './screens/Parent';
import { ParentGate } from './screens/ParentGate';
import { Report } from './screens/Report';

/**
 * Two zones. Home and Lesson are the kid zone: no AI calls. Parent, Report
 * and Create are the grown-up zone, behind the PIN (ParentGate).
 */
export function App() {
  const { path, params } = useRoute();
  switch (path) {
    // the key remounts the lesson when it changes, so nothing carries over between lessons
    case 'lesson': return <Lesson key={`${params.lesson}-${params.custom}`} params={params} />;
    case 'parent': return <ParentGate><Parent /></ParentGate>;
    case 'create': return <ParentGate><Create params={params} /></ParentGate>;
    case 'report': return <ParentGate><Report /></ParentGate>;
    default: return <Home />;
  }
}

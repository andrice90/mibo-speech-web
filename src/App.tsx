import { useRoute } from './lib/router';
import { Create } from './screens/Create';
import { Home } from './screens/Home';
import { Lesson } from './screens/Lesson';
import { Report } from './screens/Report';
import { Welcome } from './screens/Welcome';

export function App() {
  const { path, params } = useRoute();
  // the key remounts a screen when its lesson changes, so nothing carries over between lessons
  switch (path) {
    case 'welcome': return <Welcome key={`${params.lesson}-${params.resume}`} params={params} />;
    case 'lesson': return <Lesson key={`${params.lesson}-${params.custom}`} params={params} />;
    case 'create': return <Create params={params} />;
    case 'report': return <Report />;
    default: return <Home />;
  }
}

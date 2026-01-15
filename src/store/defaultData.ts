import { AppData } from '@/types';
import { uid } from '@/utils/helpers';

export function defaultData(): AppData {
  const points = [
    {
      id: uid(),
      branch: 'Алматы',
      clientCode: 'A1001',
      name: 'Магазин "Ромашка"',
      address: 'Алматы, пр. Абая 10',
      lon: 76.9279,
      lat: 43.2383,
      channel: 'Розница',
      frequencyCode: '4',
      visitMinutes: 20,
      route: 'R1',
      manager: 'Иванов И.И.',
      leer: 'Петров П.П.',
      visitDayCode: '1'
    },
    {
      id: uid(),
      branch: 'Алматы',
      clientCode: 'A1002',
      name: 'Кафе "Встреча"',
      address: 'Алматы, ул. Толе би 120',
      lon: 76.889,
      lat: 43.254,
      channel: 'HoReCa',
      frequencyCode: '2,1',
      visitMinutes: 30,
      route: 'R1',
      manager: 'Иванов И.И.',
      leer: 'Петров П.П.',
      visitDayCode: '3'
    },
    {
      id: uid(),
      branch: 'Астана',
      clientCode: 'N2001',
      name: 'Опт "Север"',
      address: 'Астана, ул. Сарыарка 5',
      lon: 71.4304,
      lat: 51.1282,
      channel: 'Опт',
      frequencyCode: '1,2',
      visitMinutes: 45,
      route: 'R2',
      manager: 'Сидоров С.С.',
      leer: 'Ким К.К.',
      visitDayCode: '5'
    }
  ];

  const polygons = [
    {
      id: uid(),
      name: 'Зона 1',
      color: '#22c55e',
      days: ['1', '3', '5'],
      coords: [
        [43.2483, 76.9179],
        [43.2483, 76.9579],
        [43.2283, 76.9579],
        [43.2283, 76.9179]
      ] as [number, number][]
    }
  ];

  const startPoints = [
    { id: uid(), route: 'R1', address: 'Склад R1, Алматы', lat: 43.245, lon: 76.91 },
    { id: uid(), route: 'R2', address: 'Склад R2, Астана', lat: 51.14, lon: 71.42 }
  ];

  const users = [
    { id: uid(), fullName: 'Администратор', login: 'admin', password: 'admin123', role: 'Admin' as const, route: '' },
    { id: uid(), fullName: 'Торговый представитель', login: 'user', password: 'user123', role: 'User' as const, route: 'R1' }
  ];

  return { users, points, polygons, startPoints, mileageReports: [], roadMileageReports: [], territoryCalcRuns: [], importMeta: { pointsFiles: [], polygonFiles: [] } };
}

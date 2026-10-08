import { 
  ChantierProject, ArtisanDirectoryItem, MarketProduct, MaintenanceTicket, UserProfile 
} from '../types';

// Guard mock/demo data so Production never exposes or depends on it.
// Mocks are ALWAYS disabled in production regardless of environment flags.
// Only non-production environments may use the built-in mock/demo datasets.
const ENABLE_MOCK_DATA = process.env.NODE_ENV !== 'production';

const _INITIAL_USER_PROFILES: UserProfile[] = [
  {
    id: 'usr_1',
    name: 'Mohamed Ben Salem',
    role: 'engineer',
    email: 'm.bensalem@konstrivo.tn',
    phone: '+216 98 123 456',
    companyName: 'BTP Ingénierie & Conseil',
    matriculeFiscale: '1428590/A/P/000',
    licenseNumber: 'OIT-2024-8842',
    region: 'Tunis Grand',
    country: 'TN',
    rating: 4.9,
    completedChantiersCount: 38
  },
  {
    id: 'usr_2',
    name: 'Karim Trabelsi',
    role: 'contractor',
    email: 'karim.placo@gmail.com',
    phone: '+216 55 987 654',
    companyName: 'Trabelsi Placo & Déco',
    matriculeFiscale: '1689230/B/N/000',
    region: 'Ariana',
    country: 'TN',
    rating: 4.8,
    completedChantiersCount: 64
  },
  {
    id: 'usr_3',
    name: 'Société Quincaillerie Moderne (SQM)',
    role: 'vendor',
    email: 'contact@sqm-materials.tn',
    phone: '+216 71 800 900',
    companyName: 'SQM Matériaux BTP',
    matriculeFiscale: '0981245/M/A/000',
    region: 'Ben Arous',
    country: 'TN',
    rating: 4.7
  },
  {
    id: 'usr_4',
    name: 'Dr. Youssef Chahed',
    role: 'client',
    email: 'ychahed.client@gmail.com',
    phone: '+216 22 334 455',
    region: 'Tunis Grand',
    country: 'TN'
  }
];

export const INITIAL_USER_PROFILES: UserProfile[] = ENABLE_MOCK_DATA ? _INITIAL_USER_PROFILES : [];

const _INITIAL_PROJECTS: ChantierProject[] = [
  {
    id: 'proj_1',
    code: 'CHT-2026-001',
    name: 'Villa Contemporaine La Marsa',
    clientName: 'M. Mehdi Gharbi',
    clientPhone: '+216 98 440 220',
    address: 'Avenue Habib Bourguiba, La Marsa, Tunis',
    region: 'Tunis Grand',
    country: 'TN',
    currency: 'TND',
    type: 'villa_neuve',
    status: 'en_cours',
    progressPercent: 68,
    budgetTotalHt: 145000,
    depensesActuellesHt: 96400,
    startDate: '2026-01-15',
    targetEndDate: '2026-05-30',
    managerName: 'Ing. Mohamed Ben Salem',
    phases: [
      {
        id: 'ph_1',
        title: 'Gros Œuvre & Maçonnerie',
        description: 'Murs extérieurs double cloison et cloisons intérieures briques 12 trous.',
        trade: 'maconnerie',
        startDate: '2026-01-15',
        endDate: '2026-02-28',
        status: 'valide',
        progressPercent: 100,
        estimatedCost: 45000,
        actualCost: 44200
      },
      {
        id: 'ph_2',
        title: 'Faux Plafonds BA13 & Caissons LED',
        description: 'Plafonds suspendus 280m² avec gorges lumineuses et isolation phonique.',
        trade: 'placo',
        startDate: '2026-03-01',
        endDate: '2026-03-25',
        status: 'en_cours',
        progressPercent: 80,
        estimatedCost: 18500,
        actualCost: 17200
      },
      {
        id: 'ph_3',
        title: 'Plomberie Encastrée & Sanitaires',
        description: 'Réseau PPR eau chaude/froide et évacuations suspendues.',
        trade: 'plomberie',
        startDate: '2026-02-20',
        endDate: '2026-03-30',
        status: 'en_cours',
        progressPercent: 70,
        estimatedCost: 22000,
        actualCost: 19800
      },
      {
        id: 'ph_4',
        title: 'Électricité & Domotique',
        description: 'Tableaux divisionnaires, gainage ICTA et appareillage Legrand.',
        trade: 'electricite',
        startDate: '2026-03-10',
        endDate: '2026-04-15',
        status: 'en_cours',
        progressPercent: 45,
        estimatedCost: 24000,
        actualCost: 15200
      },
      {
        id: 'ph_5',
        title: 'Revêtement Grès Cérame 60x120',
        description: 'Pose collée avec double encollage sol et faïence salles de bains.',
        trade: 'carrelage',
        startDate: '2026-04-01',
        endDate: '2026-04-30',
        status: 'en_attente',
        progressPercent: 0,
        estimatedCost: 21500,
        actualCost: 0
      },
      {
        id: 'ph_6',
        title: 'Peinture Décorative & Finitions',
        description: 'Enduisage 3 passes et peinture satinée lavable.',
        trade: 'peinture',
        startDate: '2026-05-01',
        endDate: '2026-05-25',
        status: 'en_attente',
        progressPercent: 0,
        estimatedCost: 14000,
        actualCost: 0
      }
    ],
    logs: [
      {
        id: 'log_1',
        date: '2026-03-24',
        time: '14:30',
        authorName: 'Mohamed Ben Salem',
        authorRole: 'Ingénieur Contrôle',
        category: 'controle_qualite',
        content: 'Vérification de l\'alignement des cornières de rive et du niveau laser des plafonds du séjour. Tolérance < 2mm respectée.',
        validated: true
      },
      {
        id: 'log_2',
        date: '2026-03-23',
        time: '09:15',
        authorName: 'Karim Trabelsi',
        authorRole: 'Chef Plaquiste',
        category: 'livraison',
        content: 'Réception de 120 plaques BA13 Hydrofuge et 80 montants 48mm. Stockage à plat à l\'abri de l\'humidité.',
        validated: true
      },
      {
        id: 'log_3',
        date: '2026-03-21',
        time: '11:00',
        authorName: 'Tarek Hamdi',
        authorRole: 'Chef Électricien',
        category: 'avancement',
        content: 'Tirage des câbles d\'alimentation climatisation VRV et gaines domotiques terminé pour le rez-de-chaussée.',
        validated: true
      }
    ],
    team: [
      { id: 'tm_1', name: 'Karim Trabelsi', roleTitle: 'Maître Plaquiste', phone: '+216 55 987 654', trade: 'placo', status: 'actif' },
      { id: 'tm_2', name: 'Nader Saidi', roleTitle: 'Plombier Sanitaire', phone: '+216 23 112 334', trade: 'plomberie', status: 'actif' },
      { id: 'tm_3', name: 'Tarek Hamdi', roleTitle: 'Électricien BTP', phone: '+216 94 556 778', trade: 'electricite', status: 'actif' },
      { id: 'tm_4', name: 'Béchir Mabrouk', roleTitle: 'Chef Carreleur', phone: '+216 52 778 990', trade: 'carrelage', status: 'en_attente' as any }
    ],
    notes: 'Priorité accordée à l\'isolation acoustique des chambres à l\'étage (doublage BA13 phonique).'
  },
  {
    id: 'proj_2',
    code: 'CHT-2026-002',
    name: 'Plateau Bureaux Open-Space Berges du Lac 2',
    clientName: 'Innovatech Corp',
    clientPhone: '+216 71 960 100',
    address: 'Rue de la Bourse, Les Berges du Lac 2, Tunis',
    region: 'Tunis Grand',
    country: 'TN',
    currency: 'TND',
    type: 'bureau',
    status: 'en_cours',
    progressPercent: 42,
    budgetTotalHt: 85000,
    depensesActuellesHt: 38200,
    startDate: '2026-02-10',
    targetEndDate: '2026-04-20',
    managerName: 'Ing. Sami Dridi',
    phases: [
      {
        id: 'ph_201',
        title: 'Plafonds Démontables 60x60 Acoustiques',
        description: 'Dalles laine minérale Armstrong avec ossature apparente T24.',
        trade: 'placo',
        startDate: '2026-02-15',
        endDate: '2026-03-15',
        status: 'valide',
        progressPercent: 100,
        estimatedCost: 22000,
        actualCost: 21400
      },
      {
        id: 'ph_202',
        title: 'Cloisons Séparatives Placo Double Peau + Verre',
        description: 'Cloisons 98/48 avec double peau BA13 et isolation acoustique.',
        trade: 'placo',
        startDate: '2026-03-05',
        endDate: '2026-03-30',
        status: 'en_cours',
        progressPercent: 55,
        estimatedCost: 31000,
        actualCost: 16800
      },
      {
        id: 'ph_203',
        title: 'Réseau Informatique & Câblage RJ45 Cat6A',
        description: 'Plinthes techniques périphériques et baie de brassage 42U.',
        trade: 'electricite',
        startDate: '2026-03-15',
        endDate: '2026-04-10',
        status: 'en_cours',
        progressPercent: 30,
        estimatedCost: 18000,
        actualCost: 0
      }
    ],
    logs: [
      {
        id: 'log_201',
        date: '2026-03-22',
        time: '16:00',
        authorName: 'Sami Dridi',
        authorRole: 'Chef de Projet',
        category: 'livraison',
        content: 'Arrivée des rails et montants 70mm renforcés pour cloisons vitrées.',
        validated: true
      }
    ],
    team: [
      { id: 'tm_201', name: 'Karim Trabelsi', roleTitle: 'Artisan Plaquiste', phone: '+216 55 987 654', trade: 'placo', status: 'actif' }
    ],
    notes: 'Exigence stricte de respect des normes coupe-feu (EI60) dans les couloirs d\'évacuation.'
  },
  {
    id: 'proj_3',
    code: 'CHT-2026-003',
    name: 'Rénovation Clinique Médicale Ennasr 2',
    clientName: 'Polyclinique El Amen',
    clientPhone: '+216 71 889 000',
    address: 'Avenue Hédi Nouira, Ennasr 2, Ariana',
    region: 'Ariana',
    country: 'TN',
    currency: 'TND',
    type: 'commercial',
    status: 'planification',
    progressPercent: 15,
    budgetTotalHt: 210000,
    depensesActuellesHt: 24000,
    startDate: '2026-03-15',
    targetEndDate: '2026-07-30',
    managerName: 'Ing. Mohamed Ben Salem',
    phases: [
      {
        id: 'ph_301',
        title: 'Cloisons Antibactériennes & Plombées Radiologie',
        description: 'Plaques Knauf Safeboard sans plomb pour radiologie et BA13 hydro-sanitaire.',
        trade: 'placo',
        startDate: '2026-03-20',
        endDate: '2026-04-30',
        status: 'en_cours',
        progressPercent: 20,
        estimatedCost: 65000,
        actualCost: 24000
      }
    ],
    logs: [],
    team: [],
    notes: 'Matériaux certifiés milieu hospitalier obligatoires.'
  }
];

export const INITIAL_PROJECTS: ChantierProject[] = ENABLE_MOCK_DATA ? _INITIAL_PROJECTS : [];

const _INITIAL_ARTISANS: ArtisanDirectoryItem[] = [
  {
    id: 'art_1',
    name: 'Karim Trabelsi',
    company: 'Trabelsi Placo & Déco Pro',
    trade: 'placo',
    secondaryTrades: ['peinture', 'isolation'],
    region: 'Tunis Grand',
    rating: 4.9,
    reviewsCount: 47,
    isVerified: true,
    isPro2026: true,
    phone: '+216 55 987 654',
    whatsapp: '21655987654',
    avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop&q=80',
    bio: 'Artisan plaquiste certifié Knauf & Siniat avec plus de 14 ans d\'expérience dans les faux plafonds modernes, caissons LED, cloisons acoustiques et habillage Aquapanel.',
    hourlyRateTnd: 22,
    squareMeterRateTnd: 18,
    services: ['Faux Plafonds BA13', 'Gorges Lumineuses LED (الكرتوش)', 'Cloisons Séparatives', 'Isolation Laine de Roche', 'Aquapanel Façades'],
    badges: ['Certifié Knauf 2026', 'Garantie Décennale', 'Équipé Laser 3D', 'Chantier Propre']
  },
  {
    id: 'art_2',
    name: 'Mongi Ben Amor',
    company: 'Amor Peinture & Finitions',
    trade: 'peinture',
    secondaryTrades: ['placo'],
    region: 'Ariana',
    rating: 4.8,
    reviewsCount: 39,
    isVerified: true,
    isPro2026: true,
    phone: '+216 98 654 321',
    whatsapp: '21698654321',
    avatar: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=150&auto=format&fit=crop&q=80',
    bio: 'Maître peintre décorateur. Spécialiste enduisage haute finition 3 passes, peinture satinée Astral, effets stuc/marbre et ravalement de façade étanche.',
    hourlyRateTnd: 18,
    squareMeterRateTnd: 9,
    services: ['Peinture Intérieure Satinée', 'Enduit de Lissage Airless', 'Peinture Façade Élastique', 'Effets Décoratifs Stuc'],
    badges: ['Applicateur Agréé Astral', 'Machine Airless Graco', 'Respect Délais']
  },
  {
    id: 'art_3',
    name: 'Béchir Mabrouk',
    company: 'Mabrouk Carrelage & Mosaïque',
    trade: 'carrelage',
    secondaryTrades: ['maconnerie'],
    region: 'Ben Arous',
    rating: 4.9,
    reviewsCount: 52,
    isVerified: true,
    isPro2026: true,
    phone: '+216 52 778 990',
    whatsapp: '21652778990',
    avatar: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=150&auto=format&fit=crop&q=80',
    bio: 'Carreleur professionnel grand format (60x120, 120x240). Système de nivellement à croisillons autonivelants, douches à l\'italienne étanches et terrasses.',
    hourlyRateTnd: 25,
    squareMeterRateTnd: 24,
    services: ['Pose Grès Cérame Grand Format', 'Douches à l\'italienne', 'Faïence Rectifiée', 'Terrasses sur Plots'],
    badges: ['Spécialiste Grand Format', 'Croisillons Raimondi', 'Étanche Garanti']
  },
  {
    id: 'art_4',
    name: 'Nader Saidi',
    company: 'Saidi Plomberie & Chauffage',
    trade: 'plomberie',
    secondaryTrades: ['etancheite'],
    region: 'Nabeul / Cap Bon',
    rating: 4.7,
    reviewsCount: 31,
    isVerified: true,
    isPro2026: false,
    phone: '+216 23 112 334',
    whatsapp: '21623112334',
    avatar: 'https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?w=150&auto=format&fit=crop&q=80',
    bio: 'Installateur sanitaire thermique. Réseaux encastrés PPR, Multicouche à sertir, pose receveurs, colonnes de douche et détection de fuites par caméra thermique.',
    hourlyRateTnd: 30,
    squareMeterRateTnd: 70,
    services: ['Installation Sanitaire Complète', 'Réseau Multicouche / PPR', 'Dépannage Fuite Urgent', 'Chauffe-eau Solaire'],
    badges: ['Intervention 24/7', 'Caméra Thermique', 'Outillage Rems']
  },
  {
    id: 'art_5',
    name: 'Tarek Hamdi',
    company: 'Hamdi Élec BTP & Domotique',
    trade: 'electricite',
    secondaryTrades: ['isolation'],
    region: 'Sousse / Sahel',
    rating: 4.9,
    reviewsCount: 64,
    isVerified: true,
    isPro2026: true,
    phone: '+216 94 556 778',
    whatsapp: '21694556778',
    avatar: 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=150&auto=format&fit=crop&q=80',
    bio: 'Électricien BTP agréé STEG. Tableaux généraux conformes NF C 15-100, éclairage architectural LED, domotique et mise à la terre.',
    hourlyRateTnd: 28,
    squareMeterRateTnd: 26,
    services: ['Tableaux Électriques & Protection', 'Éclairage Ruban LED & Spots', 'Câblage Domotique', 'Conformité STEG'],
    badges: ['Agréé STEG', 'Testeur Fluke Certifié', 'Normes NF C 15-100']
  }
];

export const INITIAL_ARTISANS: ArtisanDirectoryItem[] = ENABLE_MOCK_DATA ? _INITIAL_ARTISANS : [];



const _INITIAL_MARKETPLACE_PRODUCTS: MarketProduct[] = [
  {
    id: 'prod_1',
    name: 'Plaque de Plâtre BA13 Standard 1.20x2.50m (3m²)',
    category: 'placo',
    brand: 'Knauf Tunisie',
    priceTnd: 30.0,
    unit: 'plaque (3m²)',
    stockQty: 850,
    supplierName: 'Comptoir National du BTP',
    supplierPhone: '+216 71 430 500',
    supplierLocation: 'Zone Industrielle Charguia 2, Tunis',
    isAvailable: true,
    specs: 'Épaisseur 12.5mm, bords amincis (BA), densité standard 8.5 kg/m², conforme NF EN 520.',
    minOrderQty: 10
  },
  {
    id: 'prod_2',
    name: 'Plaque BA13 Hydrofuge H1 Verte 1.20x2.50m',
    category: 'placo',
    brand: 'Siniat / Pladur',
    priceTnd: 46.0,
    unit: 'plaque (3m²)',
    stockQty: 420,
    supplierName: 'Quincaillerie Centrale du Sud',
    supplierPhone: '+216 74 220 100',
    supplierLocation: 'Route de Gabès Km 3, Sfax',
    isAvailable: true,
    specs: 'Absorption d\'eau < 5%, idéale pour pièces humides (SDB, cuisines, buanderies).',
    minOrderQty: 5
  },
  {
    id: 'prod_3',
    name: 'Plaque Aquapanel Outdoor Ciment 1.20x2.40m',
    category: 'placo',
    brand: 'Knauf Aquapanel',
    priceTnd: 85.0,
    unit: 'plaque (2.88m²)',
    stockQty: 180,
    supplierName: 'TechnoBât Matériaux',
    supplierPhone: '+216 71 800 900',
    supplierLocation: 'Ben Arous',
    isAvailable: true,
    specs: 'Ciment armé de fibres de verre, 100% résistant à l\'eau et aux intempéries extérieures.',
    minOrderQty: 4
  },
  {
    id: 'prod_4',
    name: 'Fourrure F47 Longueur 3.00m Acier Zingué Z140',
    category: 'placo',
    brand: 'Profilés Tuniso-Européens',
    priceTnd: 7.0,
    unit: 'barre 3m',
    stockQty: 2400,
    supplierName: 'Comptoir National du BTP',
    supplierPhone: '+216 71 430 500',
    supplierLocation: 'Tunis',
    isAvailable: true,
    specs: 'Acier galvanisé 0.6mm, nervuré haute rigidité pour ossature plafond suspendu.',
    minOrderQty: 20
  },
  {
    id: 'prod_5',
    name: 'Montant M48 Longueur 3.00m Rigidifié',
    category: 'placo',
    brand: 'Knauf',
    priceTnd: 8.0,
    unit: 'barre 3m',
    stockQty: 1800,
    supplierName: 'TechnoBât Matériaux',
    supplierPhone: '+216 71 800 900',
    supplierLocation: 'Ben Arous',
    isAvailable: true,
    specs: 'Montant vertical avec opercules pour passage des gaines d\'électricité.',
    minOrderQty: 20
  },
  {
    id: 'prod_6',
    name: 'Enduit de Jointage Placo Prêt à l\'Emploi / Poudre 25kg',
    category: 'placo',
    brand: 'Knauf Uniflott / Siniat',
    priceTnd: 42.0,
    unit: 'sac 25kg',
    stockQty: 320,
    supplierName: 'Comptoir National du BTP',
    supplierPhone: '+216 71 430 500',
    supplierLocation: 'Tunis',
    isAvailable: true,
    specs: 'Temps d\'utilisation 2h, retrait quasi nul, ponçage très aisé.',
    minOrderQty: 2
  },
  {
    id: 'prod_7',
    name: 'Peinture Acrylique Satinée Astraline 10 Litres',
    category: 'peinture',
    brand: 'Astral Tunisie',
    priceTnd: 125.0,
    unit: 'seau 10L',
    stockQty: 150,
    supplierName: 'Dépôt Couleurs & Déco',
    supplierPhone: '+216 71 700 800',
    supplierLocation: 'Ariana',
    isAvailable: true,
    specs: 'Rendement 10-12 m²/L, lessivable classe 1, blancheur éclatante.',
    minOrderQty: 1
  },
  {
    id: 'prod_8',
    name: 'Colle Carrelage C2TE Haute Performance 25kg',
    category: 'carrelage',
    brand: 'Technocel / Mapei',
    priceTnd: 28.0,
    unit: 'sac 25kg',
    stockQty: 500,
    supplierName: 'Ceramica Distribution',
    supplierPhone: '+216 73 300 400',
    supplierLocation: 'Sousse',
    isAvailable: true,
    specs: 'Colle à glissement réduit et temps ouvert allongé, adaptée aux carreaux 60x120.',
    minOrderQty: 5
  },
  {
    id: 'prod_9',
    name: 'Laine de Verre avec Pare-Vapeur Alu 50mm (15m²)',
    category: 'isolation',
    brand: 'Isover / Ursa',
    priceTnd: 75.0,
    unit: 'rouleau 15m²',
    stockQty: 210,
    supplierName: 'TechnoBât Matériaux',
    supplierPhone: '+216 71 800 900',
    supplierLocation: 'Ben Arous',
    isAvailable: true,
    specs: 'Conductivité thermique Lambda 0.040, isolation phonique et thermique sous toiture et cloisons.',
    minOrderQty: 2
  }
];

export const INITIAL_MARKETPLACE_PRODUCTS: MarketProduct[] = ENABLE_MOCK_DATA ? _INITIAL_MARKETPLACE_PRODUCTS : [];

const _INITIAL_MAINTENANCE_TICKETS: MaintenanceTicket[] = [
  {
    id: 'tkt_1',
    ticketCode: 'URG-2026-101',
    title: 'Fuite Importante sous Bac Douche & Fissure Plafond',
    serviceType: 'fuite_eau',
    trade: 'plomberie',
    urgency: 'urgence_extreme_2h',
    clientName: 'Mme. Salma Bouazizi',
    clientPhone: '+216 99 223 344',
    clientAddress: 'Résidence Les Jasmins, Appt B4, Ennasr 1, Ariana',
    region: 'Ariana',
    status: 'en_intervention',
    description: 'Infiltration d\'eau à travers le plafond du voisin du dessous suite à un défaut d\'étanchéité du siphon de douche.',
    estimatedPrice: 120,
    assignedTechnician: 'Nader Saidi (Plombier Express)',
    createdAt: '2026-03-24 10:15',
    scheduledTime: '2026-03-24 11:00'
  },
  {
    id: 'tkt_2',
    ticketCode: 'URG-2026-102',
    title: 'Disjonction Générale & Court-Circuit Cuisine',
    serviceType: 'court_circuit',
    trade: 'electricite',
    urgency: 'urgent_24h',
    clientName: 'M. Férid Mansouri',
    clientPhone: '+216 50 445 566',
    clientAddress: 'Villa 12, Rue des Oliviers, Soukra',
    region: 'Tunis Grand',
    status: 'artisan_assigné',
    description: 'Le différentiel 30mA saute immédiatement dès la mise sous tension du four et du lave-vaisselle.',
    estimatedPrice: 95,
    assignedTechnician: 'Tarek Hamdi (Électricien Pro)',
    createdAt: '2026-03-24 08:30',
    scheduledTime: '2026-03-24 14:00'
  },
  {
    id: 'tkt_3',
    ticketCode: 'URG-2026-103',
    title: 'Fissure Ouverte & Décollement Bande Placo Salon',
    serviceType: 'fissure_placo',
    trade: 'placo',
    urgency: 'normal_48h',
    clientName: 'Dr. Inès Belhadj',
    clientPhone: '+216 21 889 900',
    clientAddress: 'Immeuble Le Belvédère, Menzah 6, Tunis',
    region: 'Tunis Grand',
    status: 'signalé',
    description: 'Fissure de 2 mètres le long du joint de plaque BA13 au niveau de la retombée du caisson lumineux.',
    estimatedPrice: 140,
    createdAt: '2026-03-23 16:45'
  }
];

export const INITIAL_MAINTENANCE_TICKETS: MaintenanceTicket[] = ENABLE_MOCK_DATA ? _INITIAL_MAINTENANCE_TICKETS : [];

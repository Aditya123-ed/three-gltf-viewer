import { DAYLIGHT, DAYLIGHT_NAME } from './daylight.js';

export const environments = [
	{
		id: '',
		name: 'None',
		path: null,
	},
	{
		id: 'neutral', // THREE.RoomEnvironment
		name: 'Neutral',
		path: null,
	},
	{
		id: 'substation-daylight',
		name: DAYLIGHT_NAME,
		path: DAYLIGHT.environment,
		format: '.exr',
	},
	{
		id: 'venice-sunset',
		name: 'Venice Sunset',
		path: 'https://storage.googleapis.com/donmccurdy-static/venice_sunset_1k.exr',
		format: '.exr',
	},
	{
		id: 'footprint-court',
		name: 'Footprint Court (HDR Labs)',
		path: 'https://storage.googleapis.com/donmccurdy-static/footprint_court_2k.exr',
		format: '.exr',
	},
];

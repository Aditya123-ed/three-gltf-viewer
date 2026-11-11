"""Rebuild the viewer's reference daylight using Blender 5.1 in background mode.

blender -b --factory-startup --python scripts/bake-daylight.py
Only a separate world/camera scene is created. No user model is opened or modified.
"""
import bpy
import json
import math
import tempfile
from pathlib import Path
import numpy as np

if bpy.app.version[:2] != (5, 1):
    raise RuntimeError('Use Blender 5.1 to reproduce the supplied sky model.')

root = Path(__file__).resolve().parents[1]
output = root / 'public' / 'environments'
output.mkdir(parents=True, exist_ok=True)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.device = 'CPU'
scene.cycles.samples = 4
scene.render.threads_mode = 'FIXED'
scene.render.threads = 8
scene.render.resolution_x = 2048
scene.render.resolution_y = 1024
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = 'OPEN_EXR'
scene.render.image_settings.color_mode = 'RGB'
scene.render.image_settings.color_depth = '16'
scene.render.image_settings.exr_codec = 'ZIP'
scene.render.film_transparent = False

world = bpy.data.worlds.new('Reference substation sky')
world.use_nodes = True
scene.world = world
nodes = world.node_tree.nodes
nodes.clear()
sky = nodes.new('ShaderNodeTexSky')
sky.sky_type = 'MULTIPLE_SCATTERING'
sky.sun_disc = True
sky.sun_size = math.radians(10)
sky.sun_intensity = 1
sky.sun_elevation = math.radians(30)
sky.sun_rotation = math.radians(-30)
sky.altitude = 100
sky.air_density = 1
sky.aerosol_density = 1
sky.ozone_density = 5
gamma = nodes.new('ShaderNodeGamma')
gamma.inputs['Gamma'].default_value = 0.9
background = nodes.new('ShaderNodeBackground')
background.inputs['Strength'].default_value = 1
world_output = nodes.new('ShaderNodeOutputWorld')
links = world.node_tree.links
links.new(sky.outputs['Color'], gamma.inputs['Color'])
links.new(gamma.outputs['Color'], background.inputs['Color'])
links.new(background.outputs['Background'], world_output.inputs['Surface'])

bpy.ops.object.camera_add(location=(0, 0, 0), rotation=(math.pi / 2, 0, -math.pi / 2))
scene.camera = bpy.context.object
scene.camera.data.type = 'PANO'
scene.camera.data.panorama_type = 'EQUIRECTANGULAR'

def render_world(path):
    scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)
    image = bpy.data.images.load(str(path), check_existing=False)
    pixels = np.empty(len(image.pixels), dtype=np.float32)
    image.pixels.foreach_get(pixels)
    bpy.data.images.remove(image)
    return pixels.reshape((1024, 2048, 4))[:, :, :3].astype(np.float64)

with tempfile.TemporaryDirectory(prefix='substation-sky-') as temporary:
    full = render_world(Path(temporary) / 'full.exr')
    sky.sun_disc = False
    diffuse_sky = render_world(Path(temporary) / 'sky.exr')

# Separate the solar disc from image-based light. The directional light supplies
# that energy with shadows; otherwise the same sun would be counted twice.
solar = np.maximum(full - diffuse_sky, 0)
height, width = full.shape[:2]
u = (np.arange(width) + 0.5) / width
v = (np.arange(height) + 0.5) / height
longitude = (u - 0.5) * 2 * math.pi
latitude = (v - 0.5) * math.pi
solid_angle = np.cos(latitude)[:, None] * (2 * math.pi / width) * (math.pi / height)
up = np.maximum(np.sin(latitude), 0)[:, None]
luminance = np.array([0.2126, 0.7152, 0.0722])
sky_irradiance = np.sum(diffuse_sky * (solid_angle * up)[:, :, None], axis=(0, 1))
sun_irradiance = np.sum(solar * solid_angle[:, :, None], axis=(0, 1))
# Normalize white diffuse ground to a usable display range. Exposure remains a
# viewer control because the reference image does not reveal Blender's exposure.
total_horizontal = sky_irradiance + sun_irradiance * math.sin(math.radians(30))
normalization = math.pi * 0.75 / float(total_horizontal @ luminance)
weights = (solar @ luminance) * solid_angle
directions = [
    np.cos(latitude)[:, None] * np.cos(longitude)[None, :],
    np.broadcast_to(np.sin(latitude)[:, None], (height, width)),
    np.cos(latitude)[:, None] * np.sin(longitude)[None, :],
]
sun_direction = np.array([np.sum(component * weights) for component in directions])
sun_direction /= np.linalg.norm(sun_direction)
measured_direction = sun_direction.tolist()
# Blender's sky rotation uses +Y as north. glTF converts (X,Y,Z) to (X,Z,-Y).
elevation, rotation = math.radians(30), math.radians(-30)
sun_direction = np.array([
    math.sin(rotation) * math.cos(elevation), math.sin(elevation),
    -math.cos(rotation) * math.cos(elevation),
])
sun_rgb = sun_irradiance * normalization
sun_intensity = float(np.max(sun_rgb))
sun_color_linear = (sun_rgb / sun_intensity).tolist()
normalized = diffuse_sky * normalization
# This is a smooth sky without clouds: 1K retains the gradient and saves transfer.
normalized = normalized.reshape(height // 2, 2, width // 2, 2, 3).mean(axis=(1, 3))
height, width = normalized.shape[:2]
rgba = np.ones((height, width, 4), dtype=np.float32)
rgba[:, :, :3] = normalized
image = bpy.data.images.new('Reference daylight', width=width, height=height, float_buffer=True)
image.pixels.foreach_set(rgba.reshape(-1))
image.save_render(str(output / 'substation-daylight.exr'), scene=scene)
metadata = {
    'generator': 'Blender ' + bpy.app.version_string,
    'skyModel': 'MULTIPLE_SCATTERING',
    'sunElevation': 30, 'sunRotation': -30, 'sunAngularDiameter': 10,
    'altitude': 100, 'air': 1, 'aerosols': 1, 'ozone': 5,
    'gamma': 0.9, 'worldStrength': 1,
    'groundAlbedo': sky.ground_albedo,
    'normalization': normalization,
    'sunDirection': sun_direction.tolist(),
    'measuredSunDirection': measured_direction,
    'sunIntensity': sun_intensity,
    'sunColorLinear': sun_color_linear,
    'skyHorizontalIrradiance': (sky_irradiance * normalization).tolist(),
    'environment': '/environments/substation-daylight.exr',
    'note': 'Sky-only environment plus a separate shadowed sun. Display exposure is an approximation.',
}
(root / 'src' / 'daylight-settings.json').write_text(json.dumps(metadata, indent=2) + '\n')
print('DAYLIGHT_RESULT', json.dumps(metadata))

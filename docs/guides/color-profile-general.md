# OM Color Recipe Background

A few Olympus / OM System camera models (Pen-F, E-P7, OM-3) have a "Creative Dial." When you turn that dial to COLOR, you can set saturation independently for 12 different colors. That gives you a lot of control over the look of the JPGs straight out of the camera. The whole point is to get a finished style in-camera without post-processing RAW files.

Why would you want that? There's plenty of debate about this online, but here's my take:

* It's easy and fun to share right away. Camera → Phone → Share → done. Not for your masterpieces, maybe, but great for everyday photography.
* It pushes you to visualize the final image while you're shooting, the way Ansel Adams did.
* It's a low-pressure way to learn about processing techniques and color theory.
* You can always shoot JPG and RAW together. You lose basically nothing — just a little hard drive space.

The OM System customization options are more limited than some other camera systems, and far more limited than computer-based editing. You can't adjust hue or luminance per color, only saturation. To work around this, many recipe authors lean on white balance adjustments — specifically Amber and Magenta shifts — to fake some hue changes.

The Creative Dial also has a MONO position, which lets you build the same kind of recipes for black and white. Most of the monochrome options show up on camera models without the Creative Dial too. With MONO profiles you don't set per-color saturation; instead you pick a color filter and its strength, add grain, and choose an overall tone (sepia, blue, and so on).

The dial has ART and CRT positions as well. Those are more heavy-handed, less commonly used, and om-recipes doesn't currently support recipes that rely on them.

## OM Workspace

Like many camera makers, OM System provides its own software for processing RAW files. It doesn't offer masking like Lightroom, but it covers the standard basic adjustments.

OM Workspace has a rough equivalent of Lightroom presets called "Batch processing files," which use the `.oes` extension. Every recipe here can be exported as an `.oes` file, so you can download one and try the profile on your own images in OM Workspace.

## How to share recipes

The camera writes recipe data into the JPG's extended EXIF fields. This site reads those fields to pull the recipe back out of a camera JPG. So creating a recipe here is as simple as uploading a JPG shot with new settings and giving it a name.

To keep things honest and focused on sharing recipes for in-camera use, the site only accepts images straight from the camera with no further editing. Every sample image on the site came from a Creative Dial camera with no computer-based processing.

## How to get recipes into your camera

There are two ways right now:

1. Enter the settings by hand using the dials, as described on the manual recipe load page.
2. Plug the camera into your computer with a USB-C cable and use OM Workspace to load a recipe from a SOOC (straight out of camera) JPG into one of your camera's Color Profile slots.

It would be much nicer if you could do this wirelessly from a phone. Until that exists, manual entry is often the best option and sometimes the only one. The site is built to lay out recipe information so it's quick to key into the camera by hand.

## How this site relates to OM System

This is a community-driven site with no formal connection to OM System. It was created to make discovering and sharing recipes easier — that used to happen scattered across forum threads and Facebook groups. OM System has an official [Creative Recipes](https://explore.omsystem.com/us/en/creative-recipes) page with some great recipes from various creators, but it doesn't show any recipe details — just a download link for the original JPG. There's no way to see how a recipe is built without OM Workspace and a computer.

The OM System page has a "Share your recipes" button, but submitting doesn't guarantee your recipe gets featured.

This site exists to smooth over those pain points. Anyone can share a recipe here, as long as it follows the guidelines and comes from a SOOC JPG. And every recipe is shown visually, to make manual entry and general understanding easier.

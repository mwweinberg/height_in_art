

This is a project to create an interactive website that matches a user's height to a collection of objects.  The workflow is as follows:

0. Prior to use, operator uses an object of a known height to establish reference measurements in front of a webcam. This is the calibration phase.
1. User stands in front of a webcam. The site uses ml5.js and tensorflow to estimate the height of the user.  Measurement is triggered by the user making a specific hand gesture.
2. The site assembles a random collection of objects that roughly combine to equal the height of the user, drawing from data currently located in /data/MetObjectsWithHeightAndWeight.csv.
3. The site pulls images and metadata for each matched object, matching image information in /data/MetObjectsWithHeightAndWeight.csv to images in /data/small_images.  The 'object_ID' in the csv corresponds to the file name in /small_images.
4. The site displays a stacked display of the object images, normalized in proportion to their height, next to the user
5. The site displays a QR code that can be used to load a page with information about all of the matched objects.

The folder pose_match has files for a similar project that is included for reference.  Review that folder so that this project matches the visual design and grammar, as well as workflow, of that project. 
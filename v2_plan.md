There is a ui example in the project folder for concord. lets set ourselves up to develop a v2 of
  concord that uses this as a mobile ui backbone. The desktop UI should operate essentailly the same but
  with scaled styling of course.

  1. MAJOR FEATURE CHANGES: I want to update the overall design goals for concord.
   - Goal #1: fast and lightweight text/voice/video chat hosted on device and easily reachable by another authorized device.
   - Goal #2: local-vicinity mesh networking that creates a public and secure "third space" online with people in the immediate vicinity. This is the foundational comms architecture accross the board. It manages user account auth, security validations, etc. Many users can be registered to a node and the collective compute of all the running nodes powers the infrastructure that makes the text/voice/video chatting happen. 
   - Goal #3: utilize a fast tunneling protocol that would allow a local node to connect to a non-local node as if they are local.
   - Goal #4: create a sister application that runs headless on a server that registers to the mesh network as persistently online and available for necessary mesh server-processing. 
   - Goal #5: present concored beautifully using the ui example .zip created by stitch localed in the project folder

  2. DISTRIBUTION CHANGES:
   - This is now a full ecosystem native application. There will be mobile apps for ios and for android as well as native apps for linux, mac-os, and windows. The concord-server headless application should only be avaialble on desktop. 
   - There needs to be a webui built into the native applications that runs when the usre hosts a room. another user can connect to a node via a tunnel simply by navigting to the provided link. Or a non-user can use the link to connect with a simple pin authorization. 
   - This is no longer a docker project. We will create a docker implementation on top of this for ease of deployment, but for now we focus on only developing natively. I have orrpheus running macos and I will crate a windows VM to test with as well. 


   GENERAL_NOTES:
   - user profiles and data run through this mesh network. authenticity is monitored and verified via the
  corroboration of the other nodes on the network. There should be small but visible badges that represent how legit an account is on a spectrum. 
   - users can mandate two-factor verification on your account to access. There are many ways concord protects its users fom security breaches. 
   - If a user opts-in to the local-mesh for their server their server will be discoverable by users
  within range of the mesh network. Their identity will also be corroberated by the other users on the
  mesh.
   - There is an app called "bitchat" which is just a simple local mesh network messaging app. I want
  this to work essentially the same way as that. A user doesnt need to create a matrix server and host their own
  rooms in order to make use of concord. They will have access to all public nodes in the vicinity, and
  that vicinity is modular. There should be default channels like in bitchat that are literally just anonymous mesh networked public forums. I want concord to be exactly that but with voice chat and video chat as well.
   - A user can join public voice channels, public video channels, etc using their own device as a node in a mesh matrix server.
   - every node is its own matrix instance with full text, audio, video chat capabilities. 
   - When a node connects to a server it contributes its compute power to the mainenance of that server. One user holds the keys to that server and that is verified through the mesh network. 
   - non-local users can connect to each other in the same way. there are many ways to implement this, the first one that comes to mind is to create vpn tunnels between non-local instances so they appear local to the participants. This is actually great because it gives us a perfect UX design choice. If you are using concord and you are connecting to a non-local server you pass your node through a "tunnel" to connect. So instead of concord referring to friends servers as servers we can simply call them tunnels. 
   - The system is sensitive to poor node performance and will throttle the share of the workload to nodes approproately.  
   - A user can identify their node as a backbone node. This is a special, seperate version of concord called concord-server which establishes a headless mesh network server with known dedicated resources to support it. This means there is an alternative to the mesh node-computing structure. any devices that connect to it still connect as if they are going to contribute computationally. Thats part of how the auth is maintained and how the mesh-networking architecture stays central.
   - Everything should be lightweight enough that an iphone could quickly asnd easily host a server with text, voice, and video chat by itself. A user should be able to invite someone else to their room with a link and that person should be able to fully interact with the hosts concord instance via a browser.  

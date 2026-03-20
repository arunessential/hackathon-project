provider "aws" {
  region = "ap-south-1"
}

resource "aws_vpc" "main" {
  cidr_block = "10.0.0.0/16"
}

resource "aws_subnet" "public" {
  vpc_id            = aws_vpc.main.id
  cidr_block        = "10.0.1.0/24"
  map_public_ip_on_launch = true
}

resource "aws_internet_gateway" "gw" {
  vpc_id = aws_vpc.main.id
}

resource "aws_security_group" "web_sg" {
  vpc_id = aws_vpc.main.id

  ingress {
    from_port = 80
    to_port   = 80
    protocol  = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    from_port = 3000
    to_port   = 3000
    protocol  = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    from_port = 22
    to_port   = 22
    protocol  = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_launch_template" "app" {
  name_prefix   = "app-template"
  image_id      = "ami-0f5ee92e2d63afc18" # Ubuntu
  instance_type = "t2.micro"

  network_interfaces {
    security_groups = [aws_security_group.web_sg.id]
  }

  user_data = base64encode(file("user_data.sh"))
}

resource "aws_autoscaling_group" "asg" {
  desired_capacity = 1
  max_size         = 2
  min_size         = 1

  vpc_zone_identifier = [aws_subnet.public.id]

  launch_template {
    id      = aws_launch_template.app.id
    version = "$Latest"
  }
}